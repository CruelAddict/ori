package duckdb

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/crueladdict/ori/apps/ori-server/internal/model"
)

func (a *Adapter) GetScopes(ctx context.Context) ([]model.Scope, error) {
	rows, err := a.db.QueryxContext(ctx, `
		WITH current_ctx AS (
			SELECT current_catalog() AS database_name, current_schema() AS schema_name
		), user_databases AS (
			SELECT database_name
			FROM duckdb_databases()
			WHERE NOT internal AND type = 'duckdb'
		)
		SELECT
			s.catalog_name,
			s.schema_name,
			s.catalog_name = c.database_name AND s.schema_name = c.schema_name AS is_default
		FROM information_schema.schemata s
		CROSS JOIN current_ctx c
		JOIN user_databases d ON d.database_name = s.catalog_name
		WHERE s.schema_name NOT IN ('information_schema', 'pg_catalog')
		ORDER BY
			CASE WHEN s.catalog_name = c.database_name AND s.schema_name = c.schema_name THEN 0 ELSE 1 END,
			CASE WHEN s.catalog_name = c.database_name THEN 0 ELSE 1 END,
			s.catalog_name,
			s.schema_name
	`)
	if err != nil {
		return nil, fmt.Errorf("failed to list duckdb schemas: %w", err)
	}
	defer func() {
		_ = rows.Close()
	}()

	var scopes []model.Scope
	for rows.Next() {
		var databaseName string
		var schemaName string
		var isDefault bool
		if err := rows.Scan(&databaseName, &schemaName, &isDefault); err != nil {
			return nil, fmt.Errorf("failed to scan duckdb schema: %w", err)
		}
		scopes = append(scopes, model.Schema{
			Engine:         "duckdb",
			ConnectionName: a.connectionName,
			Database:       databaseName,
			Name:           schemaName,
			IsDefault:      isDefault,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating duckdb schemas: %w", err)
	}
	return scopes, nil
}

func (a *Adapter) GetRelations(ctx context.Context, scope model.Scope) ([]model.Relation, error) {
	databaseName, schemaName, err := relationScope(scope)
	if err != nil {
		return nil, err
	}

	rows, err := a.db.QueryxContext(ctx, `
		SELECT table_name AS relation_name, 'table' AS relation_type, COALESCE(sql, '') AS definition
		FROM duckdb_tables()
		WHERE database_name = ? AND schema_name = ? AND NOT internal
		UNION ALL
		SELECT view_name AS relation_name, 'view' AS relation_type, COALESCE(sql, '') AS definition
		FROM duckdb_views()
		WHERE database_name = ? AND schema_name = ? AND NOT internal
		ORDER BY relation_name
	`, databaseName, schemaName, databaseName, schemaName)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch duckdb relations: %w", err)
	}
	defer func() {
		_ = rows.Close()
	}()

	var relations []model.Relation
	for rows.Next() {
		var name string
		var relType string
		var definition string
		if err := rows.Scan(&name, &relType, &definition); err != nil {
			return nil, fmt.Errorf("failed to scan duckdb relation: %w", err)
		}
		schemaValue := schemaName
		relations = append(relations, model.Relation{
			Name:       name,
			Type:       relType,
			Definition: definition,
			Schema:     &schemaValue,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating duckdb relations: %w", err)
	}
	return relations, nil
}

func (a *Adapter) GetColumns(ctx context.Context, scope model.Scope, relation string) ([]model.Column, error) {
	databaseName, schemaName, err := relationScope(scope)
	if err != nil {
		return nil, err
	}

	rows, err := a.db.QueryxContext(ctx, `
		WITH pk_columns AS (
			SELECT kcu.column_name, kcu.ordinal_position
			FROM information_schema.table_constraints tc
			JOIN information_schema.key_column_usage kcu
			  ON tc.constraint_catalog = kcu.constraint_catalog
			 AND tc.constraint_schema = kcu.constraint_schema
			 AND tc.constraint_name = kcu.constraint_name
			WHERE tc.table_catalog = ?
			  AND tc.table_schema = ?
			  AND tc.table_name = ?
			  AND tc.constraint_type = 'PRIMARY KEY'
		)
		SELECT
			c.column_name,
			c.ordinal_position,
			c.data_type,
			CASE WHEN c.is_nullable = 'YES' THEN false ELSE true END AS not_null,
			c.column_default,
			c.character_maximum_length,
			c.numeric_precision,
			c.numeric_scale,
			COALESCE(pk.ordinal_position, 0) AS pk_position
		FROM information_schema.columns c
		LEFT JOIN pk_columns pk ON pk.column_name = c.column_name
		WHERE c.table_catalog = ?
		  AND c.table_schema = ?
		  AND c.table_name = ?
		ORDER BY c.ordinal_position
	`, databaseName, schemaName, relation, databaseName, schemaName, relation)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch duckdb columns: %w", err)
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
			return nil, fmt.Errorf("failed to scan duckdb column: %w", err)
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
		return nil, fmt.Errorf("error iterating duckdb columns: %w", err)
	}
	return columns, nil
}

func (a *Adapter) GetConstraints(ctx context.Context, scope model.Scope, relation string) ([]model.Constraint, error) {
	constraints, err := a.getConstraints(ctx, scope, relation)
	if err != nil {
		return nil, err
	}
	return constraints, nil
}

func (a *Adapter) getConstraints(ctx context.Context, scope model.Scope, relation string) ([]model.Constraint, error) {
	databaseName, schemaName, err := relationScope(scope)
	if err != nil {
		return nil, err
	}

	rows, err := a.db.QueryxContext(ctx, `
		WITH fk_rules AS (
			SELECT
				rc.constraint_catalog AS database_name,
				rc.constraint_schema AS schema_name,
				rc.constraint_name,
				rc.unique_constraint_catalog AS referenced_database_name,
				rc.unique_constraint_schema AS referenced_schema_name,
				tc.table_name AS referenced_table_name,
				rc.update_rule,
				rc.delete_rule,
				rc.match_option
			FROM information_schema.referential_constraints rc
			JOIN information_schema.table_constraints tc
			  ON tc.constraint_catalog = rc.unique_constraint_catalog
			 AND tc.constraint_schema = rc.unique_constraint_schema
			 AND tc.constraint_name = rc.unique_constraint_name
		)
		SELECT
			c.constraint_name,
			c.constraint_type,
			c.constraint_index,
			c.constraint_text,
			c.expression,
			COALESCE(CAST(to_json(c.constraint_column_names) AS VARCHAR), '[]') AS columns_json,
			COALESCE(CAST(to_json(c.referenced_column_names) AS VARCHAR), '[]') AS referenced_columns_json,
			COALESCE(f.referenced_database_name, c.database_name) AS referenced_database_name,
			f.referenced_schema_name,
			COALESCE(f.referenced_table_name, c.referenced_table) AS referenced_table_name,
			f.update_rule,
			f.delete_rule,
			f.match_option
		FROM duckdb_constraints() c
		LEFT JOIN fk_rules f
		  ON f.database_name = c.database_name
		 AND f.schema_name = c.schema_name
		 AND f.constraint_name = c.constraint_name
		WHERE c.database_name = ?
		  AND c.schema_name = ?
		  AND c.table_name = ?
		  AND c.constraint_type <> 'NOT NULL'
		ORDER BY c.constraint_index, c.constraint_name
	`, databaseName, schemaName, relation)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch duckdb constraints: %w", err)
	}
	defer func() {
		_ = rows.Close()
	}()

	type constraintRow struct {
		name                  sql.NullString
		constraintType        string
		constraintIndex       int64
		constraintText        sql.NullString
		expression            sql.NullString
		columnsJSON           string
		referencedColumnsJSON string
		referencedDatabase    sql.NullString
		referencedSchema      sql.NullString
		referencedTable       sql.NullString
		updateRule            sql.NullString
		deleteRule            sql.NullString
		matchOption           sql.NullString
	}

	constraints := make([]model.Constraint, 0)
	for rows.Next() {
		var row constraintRow
		if err := rows.Scan(
			&row.name,
			&row.constraintType,
			&row.constraintIndex,
			&row.constraintText,
			&row.expression,
			&row.columnsJSON,
			&row.referencedColumnsJSON,
			&row.referencedDatabase,
			&row.referencedSchema,
			&row.referencedTable,
			&row.updateRule,
			&row.deleteRule,
			&row.matchOption,
		); err != nil {
			return nil, fmt.Errorf("failed to scan duckdb constraint: %w", err)
		}

		columns, err := decodeStringArray(row.columnsJSON)
		if err != nil {
			return nil, fmt.Errorf("failed to decode duckdb constraint columns: %w", err)
		}

		constraintName := row.name.String
		if constraintName == "" {
			constraintName = fallbackConstraintName(relation, row.constraintType, columns, row.constraintIndex)
		}

		constraint := model.Constraint{
			Name:        constraintName,
			Type:        row.constraintType,
			Columns:     columns,
			OnUpdate:    nullStringValue(row.updateRule),
			OnDelete:    nullStringValue(row.deleteRule),
			Match:       nullStringValue(row.matchOption),
			CheckClause: nullStringValue(row.expression),
		}

		if constraint.Type == "CHECK" && constraint.CheckClause == "" {
			constraint.CheckClause = nullStringValue(row.constraintText)
		}

		if constraint.Type == "FOREIGN KEY" {
			referencedColumns, err := decodeStringArray(row.referencedColumnsJSON)
			if err != nil {
				return nil, fmt.Errorf("failed to decode duckdb referenced columns: %w", err)
			}
			constraint.ReferencedColumns = referencedColumns
			constraint.ReferencedTable = nullStringValue(row.referencedTable)

			referencedDatabase := databaseName
			if row.referencedDatabase.Valid && row.referencedDatabase.String != "" {
				referencedDatabase = row.referencedDatabase.String
			}
			referencedSchema := schemaName
			if row.referencedSchema.Valid && row.referencedSchema.String != "" {
				referencedSchema = row.referencedSchema.String
			}
			constraint.ReferencedScope = model.Schema{
				Engine:         "duckdb",
				ConnectionName: a.connectionName,
				Database:       referencedDatabase,
				Name:           referencedSchema,
			}
		}

		constraints = append(constraints, constraint)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating duckdb constraints: %w", err)
	}
	return constraints, nil
}

func (a *Adapter) GetIndexes(ctx context.Context, scope model.Scope, relation string) ([]model.Index, error) {
	databaseName, schemaName, err := relationScope(scope)
	if err != nil {
		return nil, err
	}

	rows, err := a.db.QueryxContext(ctx, `
		SELECT index_name, is_unique, is_primary, COALESCE(sql, '') AS definition
		FROM duckdb_indexes()
		WHERE database_name = ? AND schema_name = ? AND table_name = ?
		ORDER BY index_name
	`, databaseName, schemaName, relation)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch duckdb indexes: %w", err)
	}
	defer func() {
		_ = rows.Close()
	}()

	indexes := make([]model.Index, 0)
	seenNames := make(map[string]struct{})
	for rows.Next() {
		var idx model.Index
		if err := rows.Scan(&idx.Name, &idx.Unique, &idx.Primary, &idx.Definition); err != nil {
			return nil, fmt.Errorf("failed to scan duckdb index: %w", err)
		}
		idx.Columns = parseIndexColumns(idx.Definition)
		indexes = append(indexes, idx)
		seenNames[idx.Name] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating duckdb indexes: %w", err)
	}

	constraints, err := a.getConstraints(ctx, scope, relation)
	if err != nil {
		return nil, err
	}
	for _, constraint := range constraints {
		idx, ok := synthesizeBackingIndex(constraint, seenNames)
		if !ok {
			continue
		}
		indexes = append(indexes, idx)
		seenNames[idx.Name] = struct{}{}
	}
	return indexes, nil
}

func (a *Adapter) GetTriggers(context.Context, model.Scope, string) ([]model.Trigger, error) {
	return []model.Trigger{}, nil
}

func relationScope(scope model.Scope) (string, string, error) {
	if scope == nil {
		return "", "", fmt.Errorf("scope is nil")
	}
	schemaName := scope.SchemaName()
	if schemaName == nil {
		return "", "", fmt.Errorf("duckdb requires schema in scope")
	}
	return scope.DatabaseName(), *schemaName, nil
}

func decodeStringArray(raw string) ([]string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || trimmed == "null" {
		return nil, nil
	}
	var values []string
	if err := json.Unmarshal([]byte(trimmed), &values); err != nil {
		return nil, err
	}
	return values, nil
}

func nullStringValue(value sql.NullString) string {
	if !value.Valid {
		return ""
	}
	return value.String
}

func fallbackConstraintName(relation, constraintType string, columns []string, ordinal int64) string {
	parts := []string{relation, strings.ToLower(strings.ReplaceAll(constraintType, " ", "_"))}
	parts = append(parts, columns...)
	if ordinal > 0 {
		parts = append(parts, fmt.Sprintf("%d", ordinal))
	}
	return strings.Join(parts, "_")
}

func synthesizeBackingIndex(constraint model.Constraint, seenNames map[string]struct{}) (model.Index, bool) {
	if constraint.Type != "PRIMARY KEY" && constraint.Type != "UNIQUE" && constraint.Type != "FOREIGN KEY" {
		return model.Index{}, false
	}

	name := uniqueIndexName(backingIndexName(constraint.Name), seenNames)
	idx := model.Index{
		Name:       name,
		Unique:     constraint.Type == "PRIMARY KEY" || constraint.Type == "UNIQUE",
		Primary:    constraint.Type == "PRIMARY KEY",
		Columns:    append([]string(nil), constraint.Columns...),
		Definition: fmt.Sprintf("backing index for %s constraint %s", constraint.Type, constraint.Name),
	}
	return idx, true
}

func backingIndexName(constraintName string) string {
	return constraintName + "__backing_idx"
}

func uniqueIndexName(base string, seenNames map[string]struct{}) string {
	if _, exists := seenNames[base]; !exists {
		return base
	}
	for i := 2; ; i++ {
		candidate := fmt.Sprintf("%s_%d", base, i)
		if _, exists := seenNames[candidate]; !exists {
			return candidate
		}
	}
}

func parseIndexColumns(definition string) []string {
	open := strings.Index(definition, "(")
	if open < 0 {
		return nil
	}
	close := findMatchingParen(definition, open)
	if close <= open {
		return nil
	}
	items := splitTopLevel(definition[open+1 : close])
	columns := make([]string, 0, len(items))
	for _, item := range items {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		columns = append(columns, unquoteIdentifier(item))
	}
	return columns
}

func findMatchingParen(input string, open int) int {
	depth := 0
	inSingle := false
	inDouble := false
	for i := open; i < len(input); i++ {
		ch := input[i]
		switch ch {
		case '\'':
			if !inDouble {
				if inSingle && i+1 < len(input) && input[i+1] == '\'' {
					i++
					continue
				}
				inSingle = !inSingle
			}
		case '"':
			if !inSingle {
				if inDouble && i+1 < len(input) && input[i+1] == '"' {
					i++
					continue
				}
				inDouble = !inDouble
			}
		case '(':
			if !inSingle && !inDouble {
				depth++
			}
		case ')':
			if !inSingle && !inDouble {
				depth--
				if depth == 0 {
					return i
				}
			}
		}
	}
	return -1
}

func splitTopLevel(input string) []string {
	parts := make([]string, 0)
	start := 0
	depth := 0
	inSingle := false
	inDouble := false
	for i := 0; i < len(input); i++ {
		ch := input[i]
		switch ch {
		case '\'':
			if !inDouble {
				if inSingle && i+1 < len(input) && input[i+1] == '\'' {
					i++
					continue
				}
				inSingle = !inSingle
			}
		case '"':
			if !inSingle {
				if inDouble && i+1 < len(input) && input[i+1] == '"' {
					i++
					continue
				}
				inDouble = !inDouble
			}
		case '(':
			if !inSingle && !inDouble {
				depth++
			}
		case ')':
			if !inSingle && !inDouble && depth > 0 {
				depth--
			}
		case ',':
			if !inSingle && !inDouble && depth == 0 {
				parts = append(parts, input[start:i])
				start = i + 1
			}
		}
	}
	parts = append(parts, input[start:])
	return parts
}

func unquoteIdentifier(input string) string {
	trimmed := strings.TrimSpace(input)
	if len(trimmed) >= 2 && trimmed[0] == '"' && trimmed[len(trimmed)-1] == '"' {
		return strings.ReplaceAll(trimmed[1:len(trimmed)-1], `""`, `"`)
	}
	return trimmed
}
