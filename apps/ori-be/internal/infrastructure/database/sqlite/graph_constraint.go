package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"sort"

	"github.com/crueladdict/ori/apps/ori-server/internal/model"
	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/stringutil"
)

type foreignKeyGroup struct {
	ID                int
	Columns           []string
	ReferencedColumns []string
	ReferencedTable   string
	OnUpdate          string
	OnDelete          string
	Match             string
}

func (a *Adapter) constraintNodeID(connectionName, dbName, tableName, label string) string {
	return stringutil.Slug("sqlite", connectionName, "constraint", dbName, tableName, label)
}

func (a *Adapter) buildConstraintNodes(ctx context.Context, dbName, tableName string, cols []columnInfo) ([]*model.Node, model.EdgeList, error) {
	nodes := make([]*model.Node, 0)
	edge := model.EdgeList{Items: make([]string, 0)}
	appendNode := func(node *model.Node) {
		if node == nil {
			return
		}
		nodes = append(nodes, node)
		edge.Items = append(edge.Items, node.ID)
	}

	appendNode(a.primaryKeyConstraint(dbName, tableName, cols))

	uniqueIndexes, err := a.readUniqueIndexes(ctx, dbName, tableName)
	if err != nil {
		return nil, model.EdgeList{}, err
	}
	sort.Slice(uniqueIndexes, func(i, j int) bool {
		return uniqueIndexes[i].Name < uniqueIndexes[j].Name
	})
	for _, idx := range uniqueIndexes {
		appendNode(a.uniqueConstraintNode(dbName, tableName, idx))
	}

	foreignKeys, err := a.readForeignKeys(ctx, dbName, tableName)
	if err != nil {
		return nil, model.EdgeList{}, err
	}
	sort.Slice(foreignKeys, func(i, j int) bool {
		return foreignKeys[i].ID < foreignKeys[j].ID
	})
	for _, fk := range foreignKeys {
		appendNode(a.foreignKeyNode(dbName, tableName, fk))
	}

	return nodes, edge, nil
}

type uniqueIndex struct {
	Name    string
	Columns []string
}

func (a *Adapter) readUniqueIndexes(ctx context.Context, schema, table string) ([]uniqueIndex, error) {
	query := fmt.Sprintf(`PRAGMA "%s".index_list(%s)`, stringutil.EscapeIdentifier(schema), stringutil.QuoteLiteral(table))
	rows, err := a.db.QueryContext(ctx, query)
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
		cols, err := a.readIndexColumns(ctx, schema, name)
		if err != nil {
			return nil, err
		}
		indexes = append(indexes, uniqueIndex{Name: name, Columns: cols})
	}
	return indexes, rows.Err()
}

func (a *Adapter) readIndexColumns(ctx context.Context, schema, indexName string) ([]string, error) {
	query := fmt.Sprintf(`PRAGMA "%s".index_info(%s)`, stringutil.EscapeIdentifier(schema), stringutil.QuoteLiteral(indexName))
	rows, err := a.db.QueryContext(ctx, query)
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

func (a *Adapter) readForeignKeys(ctx context.Context, schema, table string) ([]foreignKeyGroup, error) {
	query := fmt.Sprintf(`PRAGMA "%s".foreign_key_list(%s)`, stringutil.EscapeIdentifier(schema), stringutil.QuoteLiteral(table))
	rows, err := a.db.QueryContext(ctx, query)
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

func (a *Adapter) primaryKeyConstraint(dbName, table string, cols []columnInfo) *model.Node {
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
		"connection":     a.connectionName,
		"database":       dbName,
		"table":          table,
		"constraintType": "PRIMARY KEY",
		"columns":        columns,
	}
	return &model.Node{
		ID:         a.constraintNodeID(a.connectionName, dbName, table, "primary-key"),
		Type:       "constraint",
		Name:       fmt.Sprintf("PRIMARY KEY on %s", table),
		Attributes: attrs,
		Edges:      make(map[string]model.EdgeList),
		Hydrated:   true,
	}
}

func (a *Adapter) uniqueConstraintNode(dbName, table string, idx uniqueIndex) *model.Node {
	attrs := map[string]any{
		"connection":     a.connectionName,
		"database":       dbName,
		"table":          table,
		"constraintType": "UNIQUE",
		"columns":        stringutil.CopyStrings(idx.Columns),
		"indexName":      idx.Name,
	}
	return &model.Node{
		ID:         a.constraintNodeID(a.connectionName, dbName, table, fmt.Sprintf("unique-%s", idx.Name)),
		Type:       "constraint",
		Name:       fmt.Sprintf("UNIQUE %s", idx.Name),
		Attributes: attrs,
		Edges:      make(map[string]model.EdgeList),
		Hydrated:   true,
	}
}

func (a *Adapter) foreignKeyNode(dbName, table string, fk foreignKeyGroup) *model.Node {
	attrs := map[string]any{
		"connection":        a.connectionName,
		"database":          dbName,
		"table":             table,
		"constraintType":    "FOREIGN KEY",
		"columns":           stringutil.CopyStrings(fk.Columns),
		"referencedTable":   fk.ReferencedTable,
		"referencedColumns": stringutil.CopyStrings(fk.ReferencedColumns),
		"onUpdate":          fk.OnUpdate,
		"onDelete":          fk.OnDelete,
		"match":             fk.Match,
	}
	return &model.Node{
		ID:         a.constraintNodeID(a.connectionName, dbName, table, fmt.Sprintf("fk-%d", fk.ID)),
		Type:       "constraint",
		Name:       fmt.Sprintf("FOREIGN KEY %d", fk.ID),
		Attributes: attrs,
		Edges:      make(map[string]model.EdgeList),
		Hydrated:   true,
	}
}
