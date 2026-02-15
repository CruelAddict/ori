package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/crueladdict/ori/apps/ori-server/internal/model"
	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/stringutil"
)

func (a *Adapter) GetScopes(ctx context.Context) ([]model.Scope, error) {
	rows, err := a.db.QueryxContext(ctx, "PRAGMA database_list")
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = rows.Close()
	}()

	var scopes []model.Scope
	for rows.Next() {
		var seq int
		var name string
		var file sql.NullString
		if err := rows.Scan(&seq, &name, &file); err != nil {
			return nil, err
		}

		if strings.EqualFold(name, "temp") {
			continue
		}

		fileValue := file.String
		sequence := seq
		isDefault := strings.EqualFold(name, "main")

		var pageSizeValue *int64

		if pageSize, err := a.pragmaInt(ctx, name, "page_size"); err == nil {
			value := pageSize
			pageSizeValue = &value
		}
		var encodingValue *string
		if encoding, err := a.pragmaText(ctx, name, "encoding"); err == nil && encoding != "" {
			value := encoding
			encodingValue = &value
		}

		scopes = append(scopes, model.Database{
			Engine:         "sqlite",
			ConnectionName: a.connectionName,
			Name:           name,
			IsDefault:      isDefault,
			File:           &fileValue,
			Sequence:       &sequence,
			PageSize:       pageSizeValue,
			Encoding:       encodingValue,
		})
	}

	return scopes, rows.Err()
}

func (a *Adapter) pragmaInt(ctx context.Context, schema, pragma string) (int64, error) {
	query := fmt.Sprintf(`PRAGMA "%s".%s`, stringutil.EscapeIdentifier(schema), pragma)
	var value int64
	err := a.db.GetContext(ctx, &value, query)
	return value, err
}

func (a *Adapter) pragmaText(ctx context.Context, schema, pragma string) (string, error) {
	query := fmt.Sprintf(`PRAGMA "%s".%s`, stringutil.EscapeIdentifier(schema), pragma)
	var value string
	err := a.db.GetContext(ctx, &value, query)
	return value, err
}

func (a *Adapter) GetRelations(ctx context.Context, scope model.Scope) ([]model.Relation, error) {
	database := scope.DatabaseName()
	query := fmt.Sprintf(
		`SELECT name, type, COALESCE(sql, '') as sql FROM "%s".sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%%' ORDER BY name`,
		stringutil.EscapeIdentifier(database),
	)
	rows, err := a.db.QueryxContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = rows.Close()
	}()

	var relations []model.Relation
	for rows.Next() {
		var name, relType, definition string
		if err := rows.Scan(&name, &relType, &definition); err != nil {
			return nil, err
		}
		relations = append(relations, model.Relation{
			Name:       name,
			Type:       relType,
			Definition: definition,
		})
	}
	return relations, rows.Err()
}

func (a *Adapter) GetColumns(ctx context.Context, scope model.Scope, relation string) ([]model.Column, error) {
	database := scope.DatabaseName()
	query := fmt.Sprintf(
		`PRAGMA "%s".table_info(%s)`,
		stringutil.EscapeIdentifier(database),
		stringutil.QuoteLiteral(relation),
	)
	rows, err := a.db.QueryxContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = rows.Close()
	}()

	var columns []model.Column
	for rows.Next() {
		var cid int
		var name, dataType string
		var notNull, pk int
		var defaultValue sql.NullString

		if err := rows.Scan(&cid, &name, &dataType, &notNull, &defaultValue, &pk); err != nil {
			return nil, err
		}

		col := model.Column{
			Name:          name,
			Ordinal:       cid,
			DataType:      dataType,
			NotNull:       notNull == 1,
			PrimaryKeyPos: pk,
		}
		if defaultValue.Valid {
			col.DefaultValue = &defaultValue.String
		}
		columns = append(columns, col)
	}
	return columns, rows.Err()
}

func (a *Adapter) GetConstraints(ctx context.Context, scope model.Scope, relation string) ([]model.Constraint, error) {
	database := scope.DatabaseName()
	var constraints []model.Constraint

	// Primary key from columns
	pkConstraint, err := a.getPrimaryKeyConstraint(ctx, database, relation)
	if err != nil {
		return nil, err
	}
	if pkConstraint != nil {
		constraints = append(constraints, *pkConstraint)
	}

	// Unique constraints from indexes
	uniqueConstraints, err := a.getUniqueConstraints(ctx, database, relation)
	if err != nil {
		return nil, err
	}
	constraints = append(constraints, uniqueConstraints...)

	// Foreign keys
	fkConstraints, err := a.getForeignKeyConstraints(ctx, database, relation)
	if err != nil {
		return nil, err
	}
	constraints = append(constraints, fkConstraints...)

	return constraints, nil
}

func (a *Adapter) GetIndexes(ctx context.Context, scope model.Scope, relation string) ([]model.Index, error) {
	database := scope.DatabaseName()
	query := fmt.Sprintf(
		`PRAGMA "%s".index_list(%s)`,
		stringutil.EscapeIdentifier(database),
		stringutil.QuoteLiteral(relation),
	)
	rows, err := a.db.QueryxContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = rows.Close()
	}()

	type indexRow struct {
		name    string
		unique  int
		origin  string
		partial int
	}
	var entries []indexRow

	for rows.Next() {
		var seq int
		var row indexRow
		if err := rows.Scan(&seq, &row.name, &row.unique, &row.origin, &row.partial); err != nil {
			return nil, err
		}
		entries = append(entries, row)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	indexes := make([]model.Index, 0, len(entries))
	for _, entry := range entries {
		columns, err := a.getIndexColumns(ctx, database, entry.name)
		if err != nil {
			return nil, err
		}
		definition, err := a.getIndexDefinition(ctx, database, entry.name)
		if err != nil {
			return nil, err
		}
		indexes = append(indexes, model.Index{
			Name:       entry.name,
			Unique:     entry.unique == 1,
			Primary:    entry.origin == "pk",
			Columns:    columns,
			Definition: definition,
		})
	}

	return indexes, nil
}

func (a *Adapter) GetTriggers(ctx context.Context, scope model.Scope, relation string) ([]model.Trigger, error) {
	database := scope.DatabaseName()
	query := fmt.Sprintf(
		`SELECT name, sql FROM "%s".sqlite_master WHERE type = 'trigger' AND tbl_name = %s ORDER BY name`,
		stringutil.EscapeIdentifier(database),
		stringutil.QuoteLiteral(relation),
	)
	rows, err := a.db.QueryxContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = rows.Close()
	}()

	var triggers []model.Trigger
	for rows.Next() {
		var name, definition string
		if err := rows.Scan(&name, &definition); err != nil {
			return nil, err
		}
		timing, events, orientation, condition, statement := parseSQLiteTriggerDefinition(definition)
		triggers = append(triggers, model.Trigger{
			Name:        name,
			Timing:      timing,
			Events:      events,
			Orientation: orientation,
			Condition:   condition,
			Statement:   statement,
			Definition:  definition,
		})
	}
	return triggers, rows.Err()
}

func (a *Adapter) getPrimaryKeyConstraint(ctx context.Context, database, table string) (*model.Constraint, error) {
	query := fmt.Sprintf(
		`PRAGMA "%s".table_info(%s)`,
		stringutil.EscapeIdentifier(database),
		stringutil.QuoteLiteral(table),
	)
	rows, err := a.db.QueryxContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = rows.Close()
	}()

	type pkEntry struct {
		pos  int
		name string
	}
	var entries []pkEntry

	for rows.Next() {
		var cid int
		var name, dataType string
		var notNull, pk int
		var defaultValue sql.NullString

		if err := rows.Scan(&cid, &name, &dataType, &notNull, &defaultValue, &pk); err != nil {
			return nil, err
		}
		if pk > 0 {
			entries = append(entries, pkEntry{pos: pk, name: name})
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if len(entries) == 0 {
		return nil, nil
	}

	sort.Slice(entries, func(i, j int) bool { return entries[i].pos < entries[j].pos })
	columns := make([]string, 0, len(entries))
	for _, e := range entries {
		columns = append(columns, e.name)
	}

	return &model.Constraint{
		Name:    "PK",
		Type:    "PRIMARY KEY",
		Columns: columns,
	}, nil
}

func (a *Adapter) getUniqueConstraints(ctx context.Context, database, table string) ([]model.Constraint, error) {
	query := fmt.Sprintf(
		`PRAGMA "%s".index_list(%s)`,
		stringutil.EscapeIdentifier(database),
		stringutil.QuoteLiteral(table),
	)
	rows, err := a.db.QueryxContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = rows.Close()
	}()

	type indexInfo struct {
		name   string
		unique int
	}
	var indexes []indexInfo

	for rows.Next() {
		var seq int
		var name string
		var unique int
		var origin string
		var partial int
		if err := rows.Scan(&seq, &name, &unique, &origin, &partial); err != nil {
			return nil, err
		}
		if unique == 1 {
			indexes = append(indexes, indexInfo{name: name, unique: unique})
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	var constraints []model.Constraint
	for _, idx := range indexes {
		cols, err := a.getIndexColumns(ctx, database, idx.name)
		if err != nil {
			return nil, err
		}
		constraints = append(constraints, model.Constraint{
			Name:            fmt.Sprintf("unique-%s", idx.name),
			Type:            "UNIQUE",
			Columns:         cols,
			UnderlyingIndex: &idx.name,
		})
	}

	sort.Slice(constraints, func(i, j int) bool {
		return constraints[i].Name < constraints[j].Name
	})

	return constraints, nil
}

func (a *Adapter) getIndexColumns(ctx context.Context, database, indexName string) ([]string, error) {
	query := fmt.Sprintf(
		`PRAGMA "%s".index_info(%s)`,
		stringutil.EscapeIdentifier(database),
		stringutil.QuoteLiteral(indexName),
	)
	rows, err := a.db.QueryxContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = rows.Close()
	}()

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
	if err := rows.Err(); err != nil {
		return nil, err
	}

	sort.Slice(entries, func(i, j int) bool { return entries[i].seq < entries[j].seq })
	cols := make([]string, 0, len(entries))
	for _, e := range entries {
		cols = append(cols, e.name)
	}
	return cols, nil
}

func (a *Adapter) getIndexDefinition(ctx context.Context, database, indexName string) (string, error) {
	query := fmt.Sprintf(
		`SELECT sql FROM "%s".sqlite_master WHERE type = 'index' AND name = %s`,
		stringutil.EscapeIdentifier(database),
		stringutil.QuoteLiteral(indexName),
	)
	var definition sql.NullString
	err := a.db.GetContext(ctx, &definition, query)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", nil
		}
		return "", err
	}
	if definition.Valid {
		return definition.String, nil
	}
	return "", nil
}

func parseSQLiteTriggerDefinition(definition string) (string, []string, string, string, string) {
	if definition == "" {
		return "", nil, "", "", ""
	}

	normalized := strings.ReplaceAll(definition, "\n", " ")
	normalized = strings.ReplaceAll(normalized, "\t", " ")
	normalized = strings.TrimSpace(normalized)
	upper := strings.ToUpper(normalized)

	timing := ""
	events := []string{}
	orientation := ""
	condition := ""
	statement := ""

	if strings.Contains(upper, " BEFORE ") {
		timing = "BEFORE"
	} else if strings.Contains(upper, " AFTER ") {
		timing = "AFTER"
	} else if strings.Contains(upper, " INSTEAD OF ") {
		timing = "INSTEAD OF"
	}

	if strings.Contains(upper, " INSERT ") {
		events = append(events, "INSERT")
	}
	if strings.Contains(upper, " UPDATE ") {
		events = append(events, "UPDATE")
	}
	if strings.Contains(upper, " DELETE ") {
		events = append(events, "DELETE")
	}

	if strings.Contains(upper, " FOR EACH ROW ") {
		orientation = "ROW"
	} else if strings.Contains(upper, " FOR EACH STATEMENT ") {
		orientation = "STATEMENT"
	}

	if idx := strings.Index(upper, " WHEN "); idx != -1 {
		rest := normalized[idx+len(" WHEN "):]
		whenUpper := strings.ToUpper(rest)
		if beginIdx := strings.Index(whenUpper, " BEGIN "); beginIdx != -1 {
			condition = strings.TrimSpace(rest[:beginIdx])
			statement = strings.TrimSpace(rest[beginIdx+len(" BEGIN "):])
		} else {
			condition = strings.TrimSpace(rest)
		}
	} else if beginIdx := strings.Index(upper, " BEGIN "); beginIdx != -1 {
		statement = strings.TrimSpace(normalized[beginIdx+len(" BEGIN "):])
	}

	if statement != "" {
		statement = strings.TrimSuffix(statement, "END")
		statement = strings.TrimSuffix(statement, "END;")
		statement = strings.TrimSpace(statement)
	}

	if len(events) == 0 {
		events = nil
	}

	return timing, events, orientation, condition, statement
}

func (a *Adapter) getForeignKeyConstraints(ctx context.Context, database, table string) ([]model.Constraint, error) {
	query := fmt.Sprintf(
		`PRAGMA "%s".foreign_key_list(%s)`,
		stringutil.EscapeIdentifier(database),
		stringutil.QuoteLiteral(table),
	)
	rows, err := a.db.QueryxContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = rows.Close()
	}()

	type fkGroup struct {
		id         int
		refTable   string
		columns    []string
		refColumns []string
		onUpdate   string
		onDelete   string
		match      string
	}
	groups := map[int]*fkGroup{}

	for rows.Next() {
		var id, seq int
		var tableName sql.NullString
		var fromCol, toCol sql.NullString
		var onUpdate, onDelete, match sql.NullString

		if err := rows.Scan(&id, &seq, &tableName, &fromCol, &toCol, &onUpdate, &onDelete, &match); err != nil {
			return nil, err
		}

		grp, ok := groups[id]
		if !ok {
			grp = &fkGroup{id: id}
			groups[id] = grp
		}
		grp.refTable = tableName.String
		grp.onUpdate = onUpdate.String
		grp.onDelete = onDelete.String
		grp.match = match.String
		grp.columns = append(grp.columns, fromCol.String)
		grp.refColumns = append(grp.refColumns, toCol.String)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Sort by FK id
	ids := make([]int, 0, len(groups))
	for id := range groups {
		ids = append(ids, id)
	}
	sort.Ints(ids)

	constraints := make([]model.Constraint, 0, len(groups))
	for _, id := range ids {
		grp := groups[id]
		constraints = append(constraints, model.Constraint{
			Name:              fmt.Sprintf("FK on %s", grp.refTable),
			Type:              "FOREIGN KEY",
			Columns:           grp.columns,
			ReferencedScope:   model.Database{Engine: "sqlite", ConnectionName: a.connectionName, Name: database},
			ReferencedTable:   grp.refTable,
			ReferencedColumns: grp.refColumns,
			OnUpdate:          grp.onUpdate,
			OnDelete:          grp.onDelete,
			Match:             grp.match,
		})
	}

	return constraints, nil
}
