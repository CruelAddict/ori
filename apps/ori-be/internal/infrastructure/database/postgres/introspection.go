package postgres

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"github.com/crueladdict/ori/apps/ori-server/internal/model"
)

func (a *Adapter) GetScopes(ctx context.Context) ([]model.Scope, error) {
	query := `
		SELECT s.schema_name
		FROM information_schema.schemata s
		WHERE s.schema_name != 'information_schema'
		  AND s.schema_name NOT LIKE 'pg_%'
		ORDER BY s.schema_name
	`
	rows, err := a.db.QueryxContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to list schemas: %w", err)
	}
	defer func() {
		_ = rows.Close()
	}()

	var scopes []model.Scope
	for rows.Next() {
		var schemaName string
		if err := rows.Scan(&schemaName); err != nil {
			return nil, fmt.Errorf("failed to scan schema: %w", err)
		}
		scopes = append(scopes, model.Schema{
			Engine:         "postgres",
			ConnectionName: a.connectionName,
			Database:       a.config.Database,
			Name:           schemaName,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating schemas: %w", err)
	}
	return scopes, nil
}

func (a *Adapter) GetRelations(ctx context.Context, scope model.Scope) ([]model.Relation, error) {
	schema := scope.SchemaName()
	if schema == nil {
		return nil, fmt.Errorf("postgres requires schema in scope")
	}

	query := `
		SELECT
			n.nspname as schema_name,
			c.relname as table_name,
			c.relkind,
			CASE WHEN c.relkind = 'v' THEN pg_get_viewdef(c.oid, true) ELSE '' END as definition,
			pn.nspname as parent_schema,
			pc.relname as parent_name
		FROM pg_catalog.pg_class c
		JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
		LEFT JOIN pg_catalog.pg_inherits i ON i.inhrelid = c.oid
		LEFT JOIN pg_catalog.pg_class pc ON pc.oid = i.inhparent
		LEFT JOIN pg_catalog.pg_namespace pn ON pn.oid = pc.relnamespace
		WHERE (
				n.nspname = $1 AND c.relkind IN ('r', 'p', 'v')
			) OR (
				pn.nspname = $1 AND c.relkind = 'r'
			)
		ORDER BY n.nspname, c.relname
	`
	rows, err := a.db.QueryxContext(ctx, query, *schema)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch relations: %w", err)
	}
	defer func() {
		_ = rows.Close()
	}()

	var relations []model.Relation
	for rows.Next() {
		var schemaName, name, relkind, definition string
		var parentSchema sql.NullString
		var parentTable sql.NullString
		if err := rows.Scan(&schemaName, &name, &relkind, &definition, &parentSchema, &parentTable); err != nil {
			return nil, fmt.Errorf("failed to scan relation: %w", err)
		}

		relType := "table"
		if relkind == "v" {
			relType = "view"
		}

		schemaValue := schemaName
		schemaPtr := &schemaValue

		var parentSchemaPtr *string
		var parentTablePtr *string
		if parentTable.Valid && parentTable.String != "" {
			value := parentTable.String
			parentTablePtr = &value
			if parentSchema.Valid && parentSchema.String != "" {
				schemaValue := parentSchema.String
				parentSchemaPtr = &schemaValue
			}
		}

		relations = append(relations, model.Relation{
			Name:         name,
			Type:         relType,
			Definition:   definition,
			Schema:       schemaPtr,
			ParentSchema: parentSchemaPtr,
			ParentTable:  parentTablePtr,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating relations: %w", err)
	}
	return relations, nil
}

func (a *Adapter) GetColumns(ctx context.Context, scope model.Scope, relation string) ([]model.Column, error) {
	schema := scope.SchemaName()
	if schema == nil {
		return nil, fmt.Errorf("postgres requires schema in scope")
	}

	query := `
		WITH pk_columns AS (
			SELECT
				kcu.column_name,
				kcu.ordinal_position
			FROM information_schema.table_constraints tc
			JOIN information_schema.key_column_usage kcu
				ON tc.constraint_name = kcu.constraint_name
				AND tc.table_schema = kcu.table_schema
			WHERE tc.table_schema = $1
				AND tc.table_name = $2
				AND tc.constraint_type = 'PRIMARY KEY'
		)
		SELECT
			c.column_name,
			c.ordinal_position,
			c.data_type,
			CASE WHEN c.is_nullable = 'YES' THEN false ELSE true END as not_null,
			c.column_default,
			c.character_maximum_length,
			c.numeric_precision,
			c.numeric_scale,
			COALESCE(pk.ordinal_position, 0) as pk_position
		FROM information_schema.columns c
		LEFT JOIN pk_columns pk ON pk.column_name = c.column_name
		WHERE c.table_schema = $1 AND c.table_name = $2
		ORDER BY c.ordinal_position
	`
	rows, err := a.db.QueryxContext(ctx, query, *schema, relation)
	if err != nil {
		return nil, fmt.Errorf("failed to read columns: %w", err)
	}
	defer func() {
		_ = rows.Close()
	}()

	var columns []model.Column
	for rows.Next() {
		var col model.Column
		var defaultValue sql.NullString
		var charMaxLen sql.NullInt64
		var numPrecision sql.NullInt64
		var numScale sql.NullInt64
		var pkPos sql.NullInt64
		if err := rows.Scan(
			&col.Name,
			&col.Ordinal,
			&col.DataType,
			&col.NotNull,
			&defaultValue,
			&charMaxLen,
			&numPrecision,
			&numScale,
			&pkPos,
		); err != nil {
			return nil, fmt.Errorf("failed to scan column: %w", err)
		}
		if defaultValue.Valid {
			col.DefaultValue = &defaultValue.String
		}
		if charMaxLen.Valid {
			col.CharMaxLength = &charMaxLen.Int64
		}
		if numPrecision.Valid {
			col.NumericPrecision = &numPrecision.Int64
		}
		if numScale.Valid {
			col.NumericScale = &numScale.Int64
		}
		if pkPos.Valid {
			col.PrimaryKeyPos = int(pkPos.Int64)
		}
		columns = append(columns, col)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating columns: %w", err)
	}
	return columns, nil
}

func (a *Adapter) GetConstraints(ctx context.Context, scope model.Scope, relation string) ([]model.Constraint, error) {
	schema := scope.SchemaName()
	if schema == nil {
		return nil, fmt.Errorf("postgres requires schema in scope")
	}

	return a.getConstraintsFromCatalog(ctx, *schema, relation)
}

func (a *Adapter) GetIndexes(ctx context.Context, scope model.Scope, relation string) ([]model.Index, error) {
	schema := scope.SchemaName()
	if schema == nil {
		return nil, fmt.Errorf("postgres requires schema in scope")
	}

	query := `
		WITH index_columns AS (
			SELECT
				i.indexrelid,
				i.indnkeyatts,
				cols.ordinality as pos,
				pg_get_indexdef(i.indexrelid, cols.ordinality::int, true) as column_def
			FROM pg_index i
			JOIN pg_class c ON c.oid = i.indrelid
			JOIN pg_namespace n ON n.oid = c.relnamespace
			JOIN unnest(i.indkey) WITH ORDINALITY as cols(attnum, ordinality) ON true
			WHERE n.nspname = $1
				AND c.relname = $2
		),
		index_column_lists AS (
			SELECT
				indexrelid,
				string_agg(column_def, ',' ORDER BY pos) FILTER (WHERE pos <= indnkeyatts) as columns,
				string_agg(column_def, ',' ORDER BY pos) FILTER (WHERE pos > indnkeyatts) as include_columns
			FROM index_columns
			GROUP BY indexrelid
		)
		SELECT
			ic.relname as index_name,
			pg_get_indexdef(i.indexrelid) as indexdef,
			am.amname,
			pg_get_expr(i.indpred, i.indrelid) as predicate,
			COALESCE(icl.columns, '') as columns,
			COALESCE(icl.include_columns, '') as include_columns,
			i.indisunique,
			i.indisprimary
		FROM pg_index i
		JOIN pg_class c ON c.oid = i.indrelid
		JOIN pg_namespace n ON n.oid = c.relnamespace
		JOIN pg_class ic ON ic.oid = i.indexrelid
		JOIN pg_am am ON am.oid = ic.relam
		LEFT JOIN index_column_lists icl ON icl.indexrelid = i.indexrelid
		WHERE n.nspname = $1
			AND c.relname = $2
		ORDER BY ic.relname
	`

	type row struct {
		name           string
		definition     string
		method         string
		predicate      *string
		columns        string
		includeColumns string
		unique         bool
		primary        bool
	}

	rows, err := a.db.QueryxContext(ctx, query, *schema, relation)
	if err != nil {
		return nil, fmt.Errorf("failed to read indexes: %w", err)
	}
	defer func() {
		_ = rows.Close()
	}()

	var indexes []model.Index
	for rows.Next() {
		var entry row
		if err := rows.Scan(
			&entry.name,
			&entry.definition,
			&entry.method,
			&entry.predicate,
			&entry.columns,
			&entry.includeColumns,
			&entry.unique,
			&entry.primary,
		); err != nil {
			return nil, fmt.Errorf("failed to scan index: %w", err)
		}
		columns := splitCSV(entry.columns)
		includeColumns := splitCSV(entry.includeColumns)
		predicate := ""
		if entry.predicate != nil {
			predicate = *entry.predicate
		}
		indexes = append(indexes, model.Index{
			Name:           entry.name,
			Unique:         entry.unique,
			Primary:        entry.primary,
			Columns:        columns,
			IncludeColumns: includeColumns,
			Definition:     entry.definition,
			Method:         entry.method,
			Predicate:      predicate,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating indexes: %w", err)
	}
	return indexes, nil
}

func (a *Adapter) GetTriggers(ctx context.Context, scope model.Scope, relation string) ([]model.Trigger, error) {
	schema := scope.SchemaName()
	if schema == nil {
		return nil, fmt.Errorf("postgres requires schema in scope")
	}

	query := `
		SELECT 
			tg.tgname,
			CASE
				WHEN (tg.tgtype & 2) = 2 THEN 'BEFORE'
				WHEN (tg.tgtype & 64) = 64 THEN 'INSTEAD OF'
				ELSE 'AFTER'
			END as timing,
			CASE WHEN (tg.tgtype & 4) = 4 THEN true ELSE false END as row_level,
			(tg.tgtype & 28) as event_bits,
			tg.tgenabled,
			pg_get_triggerdef(tg.oid, true) as definition
		FROM pg_trigger tg
		JOIN pg_class c ON c.oid = tg.tgrelid
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = $1
			AND c.relname = $2
			AND NOT tg.tgisinternal
		ORDER BY tg.tgname
	`

	rows, err := a.db.QueryxContext(ctx, query, *schema, relation)
	if err != nil {
		return nil, fmt.Errorf("failed to read triggers: %w", err)
	}
	defer func() {
		_ = rows.Close()
	}()

	var triggers []model.Trigger
	for rows.Next() {
		var name, timing, enabledFlag, definition string
		var rowLevel bool
		var eventBits int
		if err := rows.Scan(&name, &timing, &rowLevel, &eventBits, &enabledFlag, &definition); err != nil {
			return nil, fmt.Errorf("failed to scan trigger: %w", err)
		}
		enabledState := parsePostgresTriggerEnabledState(enabledFlag)
		orientation := "STATEMENT"
		if rowLevel {
			orientation = "ROW"
		}
		triggers = append(triggers, model.Trigger{
			Name:         name,
			Timing:       timing,
			Events:       triggerEventsFromBits(eventBits),
			Orientation:  orientation,
			EnabledState: enabledState,
			Definition:   definition,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating triggers: %w", err)
	}
	return triggers, nil
}

// TODO: remove defensive slop?
func splitCSV(input string) []string {
	if input == "" {
		return nil
	}
	parts := strings.Split(input, ",")
	values := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed == "" {
			continue
		}
		values = append(values, trimmed)
	}
	if len(values) == 0 {
		return nil
	}
	return values
}

func parsePostgresTriggerEnabledState(flag string) string {
	switch flag {
	case "O":
		return "enabled"
	case "D":
		return "disabled"
	case "R":
		return "replica"
	case "A":
		return "always"
	default:
		return ""
	}
}

func triggerEventsFromBits(bits int) []string {
	events := []string{}
	if bits&4 != 0 {
		events = append(events, "INSERT")
	}
	if bits&8 != 0 {
		events = append(events, "DELETE")
	}
	if bits&16 != 0 {
		events = append(events, "UPDATE")
	}
	if bits&32 != 0 {
		events = append(events, "TRUNCATE")
	}
	if len(events) == 0 {
		return nil
	}
	return events
}

func constraintTypeFromCode(code string) string {
	switch code {
	case "p":
		return "PRIMARY KEY"
	case "u":
		return "UNIQUE"
	case "f":
		return "FOREIGN KEY"
	case "c":
		return "CHECK"
	default:
		return code
	}
}

func fkActionFromCode(code string) string {
	switch code {
	case "a":
		return "NO ACTION"
	case "r":
		return "RESTRICT"
	case "c":
		return "CASCADE"
	case "n":
		return "SET NULL"
	case "d":
		return "SET DEFAULT"
	default:
		return code
	}
}

func fkMatchFromCode(code string) string {
	switch code {
	case "s":
		return "SIMPLE"
	case "f":
		return "FULL"
	case "p":
		return "PARTIAL"
	default:
		return code
	}
}

func (a *Adapter) getConstraintsFromCatalog(ctx context.Context, schema, table string) ([]model.Constraint, error) {
	query := `
		WITH constraints AS (
			SELECT
				con.oid,
				con.conname,
				con.contype,
				con.conindid,
				con.confrelid,
				con.confupdtype,
				con.confdeltype,
				con.confmatchtype,
				con.conrelid,
				con.conbin
			FROM pg_constraint con
			JOIN pg_class c ON con.conrelid = c.oid
			JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE n.nspname = $1
				AND c.relname = $2
				AND con.contype IN ('p', 'u', 'f', 'c')
		),
		constraint_columns AS (
			SELECT
				con.oid,
				string_agg(att.attname, ',' ORDER BY cols.ordinality) as columns
			FROM pg_constraint con
			JOIN pg_class c ON con.conrelid = c.oid
			JOIN pg_namespace n ON n.oid = c.relnamespace
			JOIN unnest(con.conkey) WITH ORDINALITY cols(attnum, ordinality) ON true
			JOIN pg_attribute att ON att.attrelid = c.oid AND att.attnum = cols.attnum
			WHERE n.nspname = $1
				AND c.relname = $2
				AND con.contype IN ('p', 'u', 'f', 'c')
			GROUP BY con.oid
		),
		foreign_refs AS (
			SELECT
				con.oid,
				nref.nspname as ref_schema,
				cref.relname as ref_table,
				string_agg(att.attname, ',' ORDER BY cols.ordinality) as ref_columns
			FROM pg_constraint con
			JOIN pg_class c ON con.conrelid = c.oid
			JOIN pg_namespace n ON n.oid = c.relnamespace
			JOIN pg_class cref ON con.confrelid = cref.oid
			JOIN pg_namespace nref ON nref.oid = cref.relnamespace
			JOIN unnest(con.confkey) WITH ORDINALITY cols(attnum, ordinality) ON true
			JOIN pg_attribute att ON att.attrelid = cref.oid AND att.attnum = cols.attnum
			WHERE n.nspname = $1
				AND c.relname = $2
				AND con.contype = 'f'
			GROUP BY con.oid, nref.nspname, cref.relname
		)
		SELECT
			con.conname,
			con.contype,
			COALESCE(cc.columns, '') as columns,
			COALESCE(fr.ref_schema, '') as ref_schema,
			COALESCE(fr.ref_table, '') as ref_table,
			COALESCE(fr.ref_columns, '') as ref_columns,
			con.confupdtype,
			con.confdeltype,
			con.confmatchtype,
			COALESCE(pg_get_expr(con.conbin, con.conrelid, true), '') as check_clause,
			nullif(con.conindid, 0)::regclass::text as underlying_index
		FROM constraints con
		LEFT JOIN constraint_columns cc ON con.oid = cc.oid
		LEFT JOIN foreign_refs fr ON con.oid = fr.oid
		ORDER BY con.contype, con.conname
	`

	rows, err := a.db.QueryxContext(ctx, query, schema, table)
	if err != nil {
		return nil, fmt.Errorf("failed to read constraints: %w", err)
	}
	defer func() {
		_ = rows.Close()
	}()

	var constraints []model.Constraint
	for rows.Next() {
		var name, contype, columnsStr string
		var refSchema, refTable, refColumnsStr string
		var updateCode, deleteCode, matchCode string
		var checkClause string
		var underlyingIndex sql.NullString

		if err := rows.Scan(
			&name,
			&contype,
			&columnsStr,
			&refSchema,
			&refTable,
			&refColumnsStr,
			&updateCode,
			&deleteCode,
			&matchCode,
			&checkClause,
			&underlyingIndex,
		); err != nil {
			return nil, fmt.Errorf("failed to scan constraint: %w", err)
		}

		constraintType := constraintTypeFromCode(contype)
		c := model.Constraint{
			Name:    name,
			Type:    constraintType,
			Columns: splitCSV(columnsStr),
		}

		if constraintType == "FOREIGN KEY" {
			c.ReferencedScope = model.Schema{
				Engine:         "postgres",
				ConnectionName: a.connectionName,
				Database:       a.config.Database,
				Name:           refSchema,
			}
			c.ReferencedTable = refTable
			c.ReferencedColumns = splitCSV(refColumnsStr)
			c.OnUpdate = fkActionFromCode(updateCode)
			c.OnDelete = fkActionFromCode(deleteCode)
			c.Match = fkMatchFromCode(matchCode)
		}

		if constraintType == "CHECK" {
			c.CheckClause = checkClause
		}

		if underlyingIndex.Valid {
			c.UnderlyingIndex = &underlyingIndex.String
		}

		constraints = append(constraints, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating constraints: %w", err)
	}

	return constraints, nil
}
