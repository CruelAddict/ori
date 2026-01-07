package postgres

import (
	"context"
	"fmt"
	"strings"

	"github.com/crueladdict/ori/apps/ori-server/internal/model"
)

func (a *Adapter) GetScopes(ctx context.Context) ([]model.Scope, error) {
	query := `
		SELECT schema_name 
		FROM information_schema.schemata 
		WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
		  AND schema_name NOT LIKE 'pg_temp_%'
		  AND schema_name NOT LIKE 'pg_toast_temp_%'
		ORDER BY schema_name
	`
	rows, err := a.db.QueryContext(ctx, query)
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
	rows, err := a.db.QueryContext(ctx, query, *scope.Schema)
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
	rows, err := a.db.QueryContext(ctx, query, *scope.Schema, relation)
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

	rows, err := a.db.QueryContext(ctx, query, schema, table)
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

	rows, err := a.db.QueryContext(ctx, query, schema, table)
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
