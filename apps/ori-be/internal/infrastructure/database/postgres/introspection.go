package postgres

import (
	"context"
	"fmt"
	"strings"

	"github.com/crueladdict/ori/apps/ori-server/internal/model"
)

func (a *Adapter) GetScopes(ctx context.Context) ([]model.Scope, error) {
	query := `
		SELECT s.schema_name
		FROM information_schema.schemata s
		WHERE s.schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
		  AND s.schema_name NOT LIKE 'pg_temp_%'
		  AND s.schema_name NOT LIKE 'pg_toast_temp_%'
		  AND s.schema_name NOT IN (
			SELECT n.nspname
			FROM pg_extension e
			JOIN pg_namespace n ON n.oid = e.extnamespace
		  )
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
		scopes = append(scopes, model.Scope{
			ScopeID: model.ScopeID{
				Database: a.config.Database,
				Schema:   &schemaName,
			},
			Attrs: map[string]any{},
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating schemas: %w", err)
	}
	return scopes, nil
}

func (a *Adapter) GetRelations(ctx context.Context, scope model.ScopeID) ([]model.Relation, error) {
	if scope.Schema == nil {
		return nil, fmt.Errorf("postgres requires schema in scope")
	}

	query := `
		SELECT 
			t.table_name,
			t.table_type,
			COALESCE(v.view_definition, '')
		FROM information_schema.tables t
		LEFT JOIN information_schema.views v 
			ON t.table_schema = v.table_schema AND t.table_name = v.table_name
		WHERE t.table_schema = $1
		ORDER BY t.table_name
	`
	rows, err := a.db.QueryxContext(ctx, query, *scope.Schema)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch relations: %w", err)
	}
	defer func() {
		_ = rows.Close()
	}()

	var relations []model.Relation
	for rows.Next() {
		var name, tableType, definition string
		if err := rows.Scan(&name, &tableType, &definition); err != nil {
			return nil, fmt.Errorf("failed to scan relation: %w", err)
		}

		relType := "table"
		if tableType == "VIEW" {
			relType = "view"
		}

		relations = append(relations, model.Relation{
			Name:       name,
			Type:       relType,
			Definition: definition,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating relations: %w", err)
	}
	return relations, nil
}

func (a *Adapter) GetColumns(ctx context.Context, scope model.ScopeID, relation string) ([]model.Column, error) {
	if scope.Schema == nil {
		return nil, fmt.Errorf("postgres requires schema in scope")
	}

	query := `
		SELECT 
			column_name,
			ordinal_position,
			data_type,
			CASE WHEN is_nullable = 'YES' THEN false ELSE true END as not_null,
			column_default,
			character_maximum_length,
			numeric_precision,
			numeric_scale
		FROM information_schema.columns
		WHERE table_schema = $1 AND table_name = $2
		ORDER BY ordinal_position
	`
	rows, err := a.db.QueryxContext(ctx, query, *scope.Schema, relation)
	if err != nil {
		return nil, fmt.Errorf("failed to read columns: %w", err)
	}
	defer func() {
		_ = rows.Close()
	}()

	var columns []model.Column
	for rows.Next() {
		var col model.Column
		var defaultValue, charMaxLen, numPrecision, numScale *string
		if err := rows.Scan(
			&col.Name,
			&col.Ordinal,
			&col.DataType,
			&col.NotNull,
			&defaultValue,
			&charMaxLen,
			&numPrecision,
			&numScale,
		); err != nil {
			return nil, fmt.Errorf("failed to scan column: %w", err)
		}
		col.DefaultValue = defaultValue
		// Note: These are scanned as strings from nullable int columns
		// A cleaner approach would use sql.NullInt64 but this works for now
		columns = append(columns, col)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating columns: %w", err)
	}
	return columns, nil
}

func (a *Adapter) GetConstraints(ctx context.Context, scope model.ScopeID, relation string) ([]model.Constraint, error) {
	if scope.Schema == nil {
		return nil, fmt.Errorf("postgres requires schema in scope")
	}

	constraints, err := a.getKeyConstraints(ctx, *scope.Schema, relation)
	if err != nil {
		return nil, err
	}

	checkConstraints, err := a.getCheckConstraints(ctx, *scope.Schema, relation)
	if err != nil {
		return nil, err
	}

	return append(constraints, checkConstraints...), nil
}

func (a *Adapter) GetIndexes(ctx context.Context, scope model.ScopeID, relation string) ([]model.Index, error) {
	if scope.Schema == nil {
		return nil, fmt.Errorf("postgres requires schema in scope")
	}

	query := `
		SELECT 
			idx.indexname,
			idx.indexdef,
			am.amname,
			pg_get_expr(i.indpred, i.indrelid) as predicate,
			array_to_string(array_agg(att.attname ORDER BY cols.ordinality), ',') as columns,
			i.indisunique,
			i.indisprimary
		FROM pg_indexes idx
		JOIN pg_namespace n ON n.nspname = idx.schemaname
		JOIN pg_class ic ON ic.relname = idx.indexname AND ic.relnamespace = n.oid
		JOIN pg_index i ON i.indexrelid = ic.oid
		JOIN pg_class c ON c.oid = i.indrelid
		JOIN pg_am am ON am.oid = ic.relam
		LEFT JOIN LATERAL unnest(i.indkey) WITH ORDINALITY cols(attnum, ordinality)
			ON true
		LEFT JOIN pg_attribute att
			ON att.attrelid = c.oid
			AND att.attnum = cols.attnum
		WHERE idx.schemaname = $1
			AND idx.tablename = $2
			AND c.relname = idx.tablename
		GROUP BY idx.indexname, idx.indexdef, am.amname, predicate, i.indisunique, i.indisprimary
		ORDER BY idx.indexname
	`

	type row struct {
		name       string
		definition string
		method     string
		predicate  *string
		columns    string
		unique     bool
		primary    bool
	}

	rows, err := a.db.QueryxContext(ctx, query, *scope.Schema, relation)
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
			&entry.unique,
			&entry.primary,
		); err != nil {
			return nil, fmt.Errorf("failed to scan index: %w", err)
		}
		columns := splitCSV(entry.columns)
		predicate := ""
		if entry.predicate != nil {
			predicate = *entry.predicate
		}
		indexes = append(indexes, model.Index{
			Name:       entry.name,
			Unique:     entry.unique,
			Primary:    entry.primary,
			Columns:    columns,
			Definition: entry.definition,
			Method:     entry.method,
			Predicate:  predicate,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating indexes: %w", err)
	}
	return indexes, nil
}

func (a *Adapter) GetTriggers(ctx context.Context, scope model.ScopeID, relation string) ([]model.Trigger, error) {
	if scope.Schema == nil {
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

	rows, err := a.db.QueryxContext(ctx, query, *scope.Schema, relation)
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
		enabled := parsePostgresTriggerEnabled(enabledFlag)
		triggers = append(triggers, model.Trigger{
			Name:        name,
			Timing:      timing,
			Events:      triggerEventsFromBits(eventBits),
			Orientation: triggerOrientation(rowLevel),
			Enabled:     enabled,
			Definition:  definition,
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

func parsePostgresTriggerEnabled(flag string) *bool {
	if flag == "O" {
		enabled := true
		return &enabled
	}
	if flag == "D" {
		enabled := false
		return &enabled
	}
	return nil
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

func triggerOrientation(rowLevel bool) string {
	if rowLevel {
		return "ROW"
	}
	return "STATEMENT"
}

func (a *Adapter) getKeyConstraints(ctx context.Context, schema, table string) ([]model.Constraint, error) {
	query := `
		WITH constraint_columns AS (
			SELECT 
				tc.constraint_name,
				tc.constraint_type,
				tc.table_schema,
				tc.table_name,
				array_to_string(array_agg(kcu.column_name ORDER BY kcu.ordinal_position), ',') as columns
			FROM information_schema.table_constraints tc
			JOIN information_schema.key_column_usage kcu 
				ON tc.constraint_name = kcu.constraint_name 
				AND tc.table_schema = kcu.table_schema
			WHERE tc.table_schema = $1 
				AND tc.table_name = $2
				AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE', 'FOREIGN KEY')
			GROUP BY tc.constraint_name, tc.constraint_type, tc.table_schema, tc.table_name
		),
		foreign_key_refs AS (
			SELECT 
				tc.constraint_name,
				ccu.table_schema as ref_schema,
				ccu.table_name as ref_table,
				array_to_string(array_agg(ccu.column_name ORDER BY kcu.ordinal_position), ',') as ref_columns,
				rc.update_rule,
				rc.delete_rule
			FROM information_schema.table_constraints tc
			JOIN information_schema.key_column_usage kcu 
				ON tc.constraint_name = kcu.constraint_name 
				AND tc.table_schema = kcu.table_schema
			JOIN information_schema.constraint_column_usage ccu 
				ON tc.constraint_name = ccu.constraint_name
			JOIN information_schema.referential_constraints rc
				ON tc.constraint_name = rc.constraint_name
			WHERE tc.table_schema = $1 
				AND tc.table_name = $2
				AND tc.constraint_type = 'FOREIGN KEY'
			GROUP BY tc.constraint_name, ccu.table_schema, ccu.table_name, rc.update_rule, rc.delete_rule
		)
		SELECT 
			cc.constraint_name,
			cc.constraint_type,
			cc.columns,
			COALESCE(fkr.ref_schema, '') as ref_schema,
			COALESCE(fkr.ref_table, '') as ref_table,
			COALESCE(fkr.ref_columns, '') as ref_columns,
			COALESCE(fkr.update_rule, '') as update_rule,
			COALESCE(fkr.delete_rule, '') as delete_rule
		FROM constraint_columns cc
		LEFT JOIN foreign_key_refs fkr ON cc.constraint_name = fkr.constraint_name
		ORDER BY cc.constraint_type, cc.constraint_name
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
		var name, constraintType, columnsStr string
		var refSchema, refTable, refColumnsStr string
		var updateRule, deleteRule string

		if err := rows.Scan(
			&name,
			&constraintType,
			&columnsStr,
			&refSchema,
			&refTable,
			&refColumnsStr,
			&updateRule,
			&deleteRule,
		); err != nil {
			return nil, fmt.Errorf("failed to scan constraint: %w", err)
		}

		c := model.Constraint{
			Name:    name,
			Type:    constraintType,
			Columns: strings.Split(columnsStr, ","),
		}

		if constraintType == "FOREIGN KEY" {
			c.ReferencedScope = &model.ScopeID{
				Database: a.config.Database,
				Schema:   &refSchema,
			}
			c.ReferencedTable = refTable
			c.ReferencedColumns = strings.Split(refColumnsStr, ",")
			c.OnUpdate = updateRule
			c.OnDelete = deleteRule
		}

		constraints = append(constraints, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating constraints: %w", err)
	}

	return constraints, nil
}

func (a *Adapter) getCheckConstraints(ctx context.Context, schema, table string) ([]model.Constraint, error) {
	query := `
		SELECT 
			cc.constraint_name,
			cc.check_clause
		FROM information_schema.check_constraints cc
		JOIN information_schema.table_constraints tc 
			ON cc.constraint_name = tc.constraint_name
			AND cc.constraint_schema = tc.table_schema
		WHERE tc.table_schema = $1 
			AND tc.table_name = $2
			AND tc.constraint_type = 'CHECK'
			AND cc.constraint_name NOT LIKE '%_not_null'
		ORDER BY cc.constraint_name
	`

	rows, err := a.db.QueryxContext(ctx, query, schema, table)
	if err != nil {
		return nil, fmt.Errorf("failed to read check constraints: %w", err)
	}
	defer func() {
		_ = rows.Close()
	}()

	var constraints []model.Constraint
	for rows.Next() {
		var name, checkClause string
		if err := rows.Scan(&name, &checkClause); err != nil {
			return nil, fmt.Errorf("failed to scan check constraint: %w", err)
		}
		constraints = append(constraints, model.Constraint{
			Name:        name,
			Type:        "CHECK",
			CheckClause: checkClause,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating check constraints: %w", err)
	}
	return constraints, nil
}
