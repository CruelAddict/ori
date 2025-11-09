package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"
	"unicode"

	"github.com/crueladdict/ori/apps/ori-server/internal/model"
	"github.com/crueladdict/ori/apps/ori-server/internal/service"
)

// Adapter implements service.NodeAdapter for SQLite databases.
type Adapter struct{}

func NewAdapter() *Adapter {
	return &Adapter{}
}

func (a *Adapter) Bootstrap(ctx context.Context, req *service.NodeAdapterRequest) ([]*model.Node, error) {
	entries, err := a.listDatabases(ctx, req.DB)
	if err != nil {
		return nil, err
	}
	nodes := make([]*model.Node, 0, len(entries))
	for _, entry := range entries {
		if strings.EqualFold(entry.Name, "temp") {
			continue
		}
		attributes := map[string]any{
			"connection": req.ConnectionName,
			"database":   entry.Name,
			"file":       entry.File,
			"sequence":   entry.Seq,
			"engine":     "sqlite",
		}
		if pageSize, err := a.pragmaInt(ctx, req.DB, entry.Name, "page_size"); err == nil {
			attributes["pageSize"] = pageSize
		}
		if encoding, err := a.pragmaText(ctx, req.DB, entry.Name, "encoding"); err == nil && encoding != "" {
			attributes["encoding"] = encoding
		}
		node := &model.Node{
			ID:         a.databaseNodeID(req.ConnectionName, entry.Name),
			Type:       "database",
			Name:       a.databaseDisplayName(req.ConnectionName, entry.Name, entry.File),
			Attributes: attributes,
			Edges:      make(map[string]model.EdgeList),
			Hydrated:   false,
		}
		nodes = append(nodes, node)
	}
	if len(nodes) == 0 {
		return nil, fmt.Errorf("no sqlite databases found for configuration '%s'", req.ConnectionName)
	}
	return nodes, nil
}

// Hydrate enriches the provided node with edges and discovers its descendants.
func (a *Adapter) Hydrate(ctx context.Context, req *service.NodeAdapterRequest, target *model.Node) ([]*model.Node, error) {
	switch target.Type {
	case "database":
		return a.hydrateDatabase(ctx, req, target)
	case "table", "view":
		return a.hydrateTable(ctx, req, target)
	default:
		return []*model.Node{target}, nil
	}
}

type databaseEntry struct {
	Seq  int
	Name string
	File string
}

type relationInfo struct {
	Name string
	Type string
	SQL  string
}

type columnInfo struct {
	CID          int
	Name         string
	DataType     string
	NotNull      bool
	DefaultValue sql.NullString
	PK           int
}

type foreignKeyGroup struct {
	ID                int
	Columns           []string
	ReferencedColumns []string
	ReferencedTable   string
	OnUpdate          string
	OnDelete          string
	Match             string
}

func (a *Adapter) listDatabases(ctx context.Context, db *sql.DB) ([]databaseEntry, error) {
	rows, err := db.QueryContext(ctx, "PRAGMA database_list")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []databaseEntry
	for rows.Next() {
		var entry databaseEntry
		var file sql.NullString
		if err := rows.Scan(&entry.Seq, &entry.Name, &file); err != nil {
			return nil, err
		}
		entry.File = file.String
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}

func (a *Adapter) hydrateDatabase(ctx context.Context, req *service.NodeAdapterRequest, target *model.Node) ([]*model.Node, error) {
	dbName, _ := target.Attributes["database"].(string)
	if dbName == "" {
		return nil, fmt.Errorf("database node %s missing 'database' attribute", target.ID)
	}

	tables, err := a.fetchRelations(ctx, req.DB, dbName, "table")
	if err != nil {
		return nil, err
	}
	views, err := a.fetchRelations(ctx, req.DB, dbName, "view")
	if err != nil {
		return nil, err
	}

	childNodes := []*model.Node{target}
	tableEdge := model.EdgeList{Items: make([]string, 0, len(tables))}
	viewEdge := model.EdgeList{Items: make([]string, 0, len(views))}

	for _, rel := range tables {
		relNode := a.buildRelationNode(req, dbName, rel)
		childNodes = append(childNodes, relNode)
		tableEdge.Items = append(tableEdge.Items, relNode.ID)
	}
	for _, rel := range views {
		relNode := a.buildRelationNode(req, dbName, rel)
		childNodes = append(childNodes, relNode)
		viewEdge.Items = append(viewEdge.Items, relNode.ID)
	}

	target.Edges["tables"] = tableEdge
	target.Edges["views"] = viewEdge
	target.Hydrated = true
	return childNodes, nil
}

func (a *Adapter) hydrateTable(ctx context.Context, req *service.NodeAdapterRequest, target *model.Node) ([]*model.Node, error) {
	dbName, _ := target.Attributes["database"].(string)
	tableName, _ := target.Attributes["table"].(string)
	if dbName == "" || tableName == "" {
		return nil, fmt.Errorf("table node %s missing database/table attributes", target.ID)
	}

	cols, err := a.readTableColumns(ctx, req.DB, dbName, tableName)
	if err != nil {
		return nil, err
	}
	columnNodes, columnEdge := a.buildColumnNodes(req, dbName, tableName, cols)

	constraintNodes, constraintEdge, err := a.buildConstraintNodes(ctx, req, dbName, tableName, cols)
	if err != nil {
		return nil, err
	}

	target.Edges["columns"] = columnEdge
	target.Edges["constraints"] = constraintEdge
	target.Hydrated = true

	nodes := make([]*model.Node, 0, 1+len(columnNodes)+len(constraintNodes))
	nodes = append(nodes, target)
	nodes = append(nodes, columnNodes...)
	nodes = append(nodes, constraintNodes...)
	return nodes, nil
}

func (a *Adapter) fetchRelations(ctx context.Context, db *sql.DB, schema, relType string) ([]relationInfo, error) {
	query := fmt.Sprintf(`SELECT name, type, COALESCE(sql, '') as sql FROM "%s".sqlite_master WHERE type = %s AND name NOT LIKE 'sqlite_%%' ORDER BY name`,
		escapeIdentifier(schema), quoteLiteral(relType))
	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []relationInfo
	for rows.Next() {
		var rel relationInfo
		if err := rows.Scan(&rel.Name, &rel.Type, &rel.SQL); err != nil {
			return nil, err
		}
		results = append(results, rel)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return results, nil
}

func (a *Adapter) buildRelationNode(req *service.NodeAdapterRequest, dbName string, rel relationInfo) *model.Node {
	attributes := map[string]any{
		"connection": req.ConnectionName,
		"database":   dbName,
		"table":      rel.Name,
		"tableType":  rel.Type,
	}
	if rel.SQL != "" {
		attributes["definition"] = rel.SQL
	}
	return &model.Node{
		ID:         a.tableNodeID(req.ConnectionName, dbName, rel.Name, rel.Type),
		Type:       rel.Type,
		Name:       rel.Name,
		Attributes: attributes,
		Edges:      make(map[string]model.EdgeList),
		Hydrated:   false,
	}
}

func (a *Adapter) readTableColumns(ctx context.Context, db *sql.DB, schema, table string) ([]columnInfo, error) {
	query := fmt.Sprintf(`PRAGMA "%s".table_info(%s)`, escapeIdentifier(schema), quoteLiteral(table))
	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var columns []columnInfo
	for rows.Next() {
		var col columnInfo
		var notNull int
		if err := rows.Scan(&col.CID, &col.Name, &col.DataType, &notNull, &col.DefaultValue, &col.PK); err != nil {
			return nil, err
		}
		col.NotNull = notNull == 1
		columns = append(columns, col)
	}
	return columns, rows.Err()
}

func (a *Adapter) buildColumnNodes(req *service.NodeAdapterRequest, dbName, tableName string, cols []columnInfo) ([]*model.Node, model.EdgeList) {
	nodes := make([]*model.Node, 0, len(cols))
	edge := model.EdgeList{Items: make([]string, 0, len(cols))}
	for _, col := range cols {
		attrs := map[string]any{
			"connection":         req.ConnectionName,
			"database":           dbName,
			"table":              tableName,
			"column":             col.Name,
			"ordinal":            col.CID,
			"dataType":           col.DataType,
			"notNull":            col.NotNull,
			"primaryKeyPosition": col.PK,
		}
		if col.DefaultValue.Valid {
			attrs["defaultValue"] = col.DefaultValue.String
		}
		node := &model.Node{
			ID:         a.columnNodeID(req.ConnectionName, dbName, tableName, col.Name),
			Type:       "column",
			Name:       col.Name,
			Attributes: attrs,
			Edges:      make(map[string]model.EdgeList),
			Hydrated:   true,
		}
		nodes = append(nodes, node)
		edge.Items = append(edge.Items, node.ID)
	}
	return nodes, edge
}

func (a *Adapter) buildConstraintNodes(ctx context.Context, req *service.NodeAdapterRequest, dbName, tableName string, cols []columnInfo) ([]*model.Node, model.EdgeList, error) {
	nodes := make([]*model.Node, 0)
	edge := model.EdgeList{Items: make([]string, 0)}
	appendNode := func(node *model.Node) {
		if node == nil {
			return
		}
		nodes = append(nodes, node)
		edge.Items = append(edge.Items, node.ID)
	}

	appendNode(a.primaryKeyConstraint(req, dbName, tableName, cols))

	uniqueIndexes, err := a.readUniqueIndexes(ctx, req.DB, dbName, tableName)
	if err != nil {
		return nil, model.EdgeList{}, err
	}
	sort.Slice(uniqueIndexes, func(i, j int) bool {
		return uniqueIndexes[i].Name < uniqueIndexes[j].Name
	})
	for _, idx := range uniqueIndexes {
		appendNode(a.uniqueConstraintNode(req, dbName, tableName, idx))
	}

	foreignKeys, err := a.readForeignKeys(ctx, req.DB, dbName, tableName)
	if err != nil {
		return nil, model.EdgeList{}, err
	}
	sort.Slice(foreignKeys, func(i, j int) bool {
		return foreignKeys[i].ID < foreignKeys[j].ID
	})
	for _, fk := range foreignKeys {
		appendNode(a.foreignKeyNode(req, dbName, tableName, fk))
	}

	return nodes, edge, nil
}

type uniqueIndex struct {
	Name    string
	Columns []string
}

func (a *Adapter) readUniqueIndexes(ctx context.Context, db *sql.DB, schema, table string) ([]uniqueIndex, error) {
	query := fmt.Sprintf(`PRAGMA "%s".index_list(%s)`, escapeIdentifier(schema), quoteLiteral(table))
	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var indexes []uniqueIndex
	for rows.Next() {
		var seq int
		var name string
		var unique int
		var origin string
		var partial int
		if err := rows.Scan(&seq, &name, &unique, &origin, &partial); err != nil {
			return nil, err
		}
		if unique != 1 {
			continue
		}
		cols, err := a.readIndexColumns(ctx, db, schema, name)
		if err != nil {
			return nil, err
		}
		indexes = append(indexes, uniqueIndex{Name: name, Columns: cols})
	}
	return indexes, rows.Err()
}

func (a *Adapter) readIndexColumns(ctx context.Context, db *sql.DB, schema, indexName string) ([]string, error) {
	query := fmt.Sprintf(`PRAGMA "%s".index_info(%s)`, escapeIdentifier(schema), quoteLiteral(indexName))
	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type entry struct {
		seq  int
		name string
	}
	var entries []entry
	for rows.Next() {
		var e entry
		var cid int
		if err := rows.Scan(&e.seq, &cid, &e.name); err != nil {
			return nil, err
		}
		entries = append(entries, e)
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].seq < entries[j].seq })
	cols := make([]string, 0, len(entries))
	for _, e := range entries {
		cols = append(cols, e.name)
	}
	return cols, rows.Err()
}

func (a *Adapter) readForeignKeys(ctx context.Context, db *sql.DB, schema, table string) ([]foreignKeyGroup, error) {
	query := fmt.Sprintf(`PRAGMA "%s".foreign_key_list(%s)`, escapeIdentifier(schema), quoteLiteral(table))
	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	groups := map[int]*foreignKeyGroup{}
	for rows.Next() {
		var (
			id, seq                     int
			tableName                   sql.NullString
			fromCol, toCol              sql.NullString
			onUpdate, onDelete, matchCS sql.NullString
		)
		if err := rows.Scan(&id, &seq, &tableName, &fromCol, &toCol, &onUpdate, &onDelete, &matchCS); err != nil {
			return nil, err
		}
		grp, ok := groups[id]
		if !ok {
			grp = &foreignKeyGroup{ID: id}
			groups[id] = grp
		}
		grp.ReferencedTable = tableName.String
		grp.OnUpdate = onUpdate.String
		grp.OnDelete = onDelete.String
		grp.Match = matchCS.String
		grp.Columns = append(grp.Columns, fromCol.String)
		grp.ReferencedColumns = append(grp.ReferencedColumns, toCol.String)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	result := make([]foreignKeyGroup, 0, len(groups))
	for _, grp := range groups {
		result = append(result, *grp)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ID < result[j].ID })
	return result, nil
}

func (a *Adapter) primaryKeyConstraint(req *service.NodeAdapterRequest, dbName, table string, cols []columnInfo) *model.Node {
	type pkEntry struct {
		pos  int
		name string
	}
	var entries []pkEntry
	for _, col := range cols {
		if col.PK > 0 {
			entries = append(entries, pkEntry{pos: col.PK, name: col.Name})
		}
	}
	if len(entries) == 0 {
		return nil
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].pos < entries[j].pos })
	columns := make([]string, 0, len(entries))
	for _, entry := range entries {
		columns = append(columns, entry.name)
	}
	attrs := map[string]any{
		"connection":     req.ConnectionName,
		"database":       dbName,
		"table":          table,
		"constraintType": "PRIMARY KEY",
		"columns":        columns,
	}
	return &model.Node{
		ID:         a.constraintNodeID(req.ConnectionName, dbName, table, "primary-key"),
		Type:       "constraint",
		Name:       fmt.Sprintf("PRIMARY KEY on %s", table),
		Attributes: attrs,
		Edges:      make(map[string]model.EdgeList),
		Hydrated:   true,
	}
}

func (a *Adapter) uniqueConstraintNode(req *service.NodeAdapterRequest, dbName, table string, idx uniqueIndex) *model.Node {
	attrs := map[string]any{
		"connection":     req.ConnectionName,
		"database":       dbName,
		"table":          table,
		"constraintType": "UNIQUE",
		"columns":        copyStrings(idx.Columns),
		"indexName":      idx.Name,
	}
	return &model.Node{
		ID:         a.constraintNodeID(req.ConnectionName, dbName, table, fmt.Sprintf("unique-%s", idx.Name)),
		Type:       "constraint",
		Name:       fmt.Sprintf("UNIQUE %s", idx.Name),
		Attributes: attrs,
		Edges:      make(map[string]model.EdgeList),
		Hydrated:   true,
	}
}

func (a *Adapter) foreignKeyNode(req *service.NodeAdapterRequest, dbName, table string, fk foreignKeyGroup) *model.Node {
	attrs := map[string]any{
		"connection":        req.ConnectionName,
		"database":          dbName,
		"table":             table,
		"constraintType":    "FOREIGN KEY",
		"columns":           copyStrings(fk.Columns),
		"referencedTable":   fk.ReferencedTable,
		"referencedColumns": copyStrings(fk.ReferencedColumns),
		"onUpdate":          fk.OnUpdate,
		"onDelete":          fk.OnDelete,
		"match":             fk.Match,
	}
	return &model.Node{
		ID:         a.constraintNodeID(req.ConnectionName, dbName, table, fmt.Sprintf("fk-%d", fk.ID)),
		Type:       "constraint",
		Name:       fmt.Sprintf("FOREIGN KEY %d", fk.ID),
		Attributes: attrs,
		Edges:      make(map[string]model.EdgeList),
		Hydrated:   true,
	}
}

func (a *Adapter) databaseNodeID(connectionName, dbName string) string {
	return slug("sqlite", connectionName, "database", dbName)
}

func (a *Adapter) tableNodeID(connectionName, dbName, tableName, relType string) string {
	return slug("sqlite", connectionName, relType, dbName, tableName)
}

func (a *Adapter) columnNodeID(connectionName, dbName, tableName, columnName string) string {
	return slug("sqlite", connectionName, "column", dbName, tableName, columnName)
}

func (a *Adapter) constraintNodeID(connectionName, dbName, tableName, label string) string {
	return slug("sqlite", connectionName, "constraint", dbName, tableName, label)
}

func (a *Adapter) databaseDisplayName(connectionName, dbName, file string) string {
	if file == "" {
		return fmt.Sprintf("%s (%s)", dbName, connectionName)
	}
	return fmt.Sprintf("%s (%s)", dbName, file)
}

func (a *Adapter) pragmaInt(ctx context.Context, db *sql.DB, schema, pragma string) (int64, error) {
	query := fmt.Sprintf(`PRAGMA "%s".%s`, escapeIdentifier(schema), pragma)
	var value int64
	err := db.QueryRowContext(ctx, query).Scan(&value)
	return value, err
}

func (a *Adapter) pragmaText(ctx context.Context, db *sql.DB, schema, pragma string) (string, error) {
	query := fmt.Sprintf(`PRAGMA "%s".%s`, escapeIdentifier(schema), pragma)
	var value string
	err := db.QueryRowContext(ctx, query).Scan(&value)
	return value, err
}

func copyStrings(src []string) []string {
	if len(src) == 0 {
		return nil
	}
	dst := make([]string, len(src))
	copy(dst, src)
	return dst
}

func slug(parts ...string) string {
	var tokens []string
	for _, part := range parts {
		p := strings.TrimSpace(part)
		if p == "" {
			continue
		}
		var b strings.Builder
		lastDash := false
		for _, r := range strings.ToLower(p) {
			if unicode.IsLetter(r) || unicode.IsDigit(r) {
				b.WriteRune(r)
				lastDash = false
				continue
			}
			if !lastDash {
				b.WriteRune('-')
				lastDash = true
			}
		}
		token := strings.Trim(b.String(), "-")
		if token != "" {
			tokens = append(tokens, token)
		}
	}
	if len(tokens) == 0 {
		return "node"
	}
	return strings.Join(tokens, "-")
}

func escapeIdentifier(input string) string {
	return strings.ReplaceAll(input, "\"", "\"\"")
}

func quoteLiteral(input string) string {
	return fmt.Sprintf("'%s'", strings.ReplaceAll(input, "'", "''"))
}
