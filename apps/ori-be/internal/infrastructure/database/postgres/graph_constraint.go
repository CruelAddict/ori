package postgres

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/crueladdict/ori/apps/ori-server/internal/model"
	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/stringutil"
)

type constraintInfo struct {
	Name        string
	Type        string
	Columns     []string
	RefTable    string
	RefSchema   string
	RefColumns  []string
	UpdateRule  string
	DeleteRule  string
	CheckClause string
}

// constraintNodeID generates a unique ID for a constraint node
func (a *Adapter) constraintNodeID(connectionName, schemaName, tableName, constraintName string) string {
	return stringutil.Slug("postgres", connectionName, "constraint", schemaName, tableName, constraintName)
}

// buildConstraintNodes discovers and creates nodes for table constraints
func (a *Adapter) buildConstraintNodes(ctx context.Context, schemaName, tableName string) ([]*model.Node, model.EdgeList, error) {
	constraints, err := a.readConstraints(ctx, schemaName, tableName)
	if err != nil {
		return nil, model.EdgeList{}, err
	}

	// Sort constraints by type then name for consistent ordering
	sort.Slice(constraints, func(i, j int) bool {
		if constraints[i].Type != constraints[j].Type {
			// Primary key first, then unique, then foreign key, then check
			typeOrder := map[string]int{"PRIMARY KEY": 0, "UNIQUE": 1, "FOREIGN KEY": 2, "CHECK": 3}
			return typeOrder[constraints[i].Type] < typeOrder[constraints[j].Type]
		}
		return constraints[i].Name < constraints[j].Name
	})

	nodes := make([]*model.Node, 0, len(constraints))
	edge := model.EdgeList{Items: make([]string, 0, len(constraints))}

	for _, c := range constraints {
		node := a.buildConstraintNode(schemaName, tableName, c)
		nodes = append(nodes, node)
		edge.Items = append(edge.Items, node.ID)
	}

	return nodes, edge, nil
}

// readConstraints retrieves all constraints for a table
func (a *Adapter) readConstraints(ctx context.Context, schemaName, tableName string) ([]constraintInfo, error) {
	// Query to get all constraints with their columns
	// Use array_to_string to convert arrays to comma-separated strings for easier scanning
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

	rows, err := a.db.QueryContext(ctx, query, schemaName, tableName)
	if err != nil {
		return nil, fmt.Errorf("failed to read constraints: %w", err)
	}
	defer func() {
		_ = rows.Close()
	}()

	var constraints []constraintInfo
	for rows.Next() {
		var c constraintInfo
		var columnsStr, refColumnsStr string
		if err := rows.Scan(
			&c.Name,
			&c.Type,
			&columnsStr,
			&c.RefSchema,
			&c.RefTable,
			&refColumnsStr,
			&c.UpdateRule,
			&c.DeleteRule,
		); err != nil {
			return nil, fmt.Errorf("failed to scan constraint: %w", err)
		}
		c.Columns = splitColumns(columnsStr)
		c.RefColumns = splitColumns(refColumnsStr)
		constraints = append(constraints, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating constraints: %w", err)
	}

	// Also fetch check constraints
	checkConstraints, err := a.readCheckConstraints(ctx, schemaName, tableName)
	if err != nil {
		return nil, err
	}
	constraints = append(constraints, checkConstraints...)

	return constraints, nil
}

// splitColumns splits a comma-separated string into a slice of column names
func splitColumns(s string) []string {
	if s == "" {
		return nil
	}
	return strings.Split(s, ",")
}

// readCheckConstraints retrieves check constraints for a table
func (a *Adapter) readCheckConstraints(ctx context.Context, schemaName, tableName string) ([]constraintInfo, error) {
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

	rows, err := a.db.QueryContext(ctx, query, schemaName, tableName)
	if err != nil {
		return nil, fmt.Errorf("failed to read check constraints: %w", err)
	}
	defer func() {
		_ = rows.Close()
	}()

	var constraints []constraintInfo
	for rows.Next() {
		var c constraintInfo
		c.Type = "CHECK"
		if err := rows.Scan(&c.Name, &c.CheckClause); err != nil {
			return nil, fmt.Errorf("failed to scan check constraint: %w", err)
		}
		constraints = append(constraints, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating check constraints: %w", err)
	}
	return constraints, nil
}

// buildConstraintNode creates a node for a constraint
func (a *Adapter) buildConstraintNode(schemaName, tableName string, c constraintInfo) *model.Node {
	attrs := map[string]any{
		"connection":     a.connectionName,
		"database":       a.config.Database,
		"schema":         schemaName,
		"table":          tableName,
		"constraintName": c.Name,
		"constraintType": c.Type,
	}

	var displayName string

	switch c.Type {
	case "PRIMARY KEY":
		attrs["columns"] = stringutil.CopyStrings(c.Columns)
		displayName = fmt.Sprintf("PRIMARY KEY (%s)", strings.Join(c.Columns, ", "))

	case "UNIQUE":
		attrs["columns"] = stringutil.CopyStrings(c.Columns)
		displayName = fmt.Sprintf("UNIQUE (%s)", strings.Join(c.Columns, ", "))

	case "FOREIGN KEY":
		attrs["columns"] = stringutil.CopyStrings(c.Columns)
		attrs["referencedSchema"] = c.RefSchema
		attrs["referencedTable"] = c.RefTable
		attrs["referencedColumns"] = stringutil.CopyStrings(c.RefColumns)
		if c.UpdateRule != "" {
			attrs["onUpdate"] = c.UpdateRule
		}
		if c.DeleteRule != "" {
			attrs["onDelete"] = c.DeleteRule
		}
		displayName = fmt.Sprintf("FOREIGN KEY (%s) -> %s.%s(%s)",
			strings.Join(c.Columns, ", "),
			c.RefSchema, c.RefTable,
			strings.Join(c.RefColumns, ", "))

	case "CHECK":
		attrs["checkClause"] = c.CheckClause
		displayName = fmt.Sprintf("CHECK %s", c.Name)
	}

	return &model.Node{
		ID:         a.constraintNodeID(a.connectionName, schemaName, tableName, c.Name),
		Type:       "constraint",
		Name:       displayName,
		Attributes: attrs,
		Edges:      make(map[string]model.EdgeList),
		Hydrated:   true,
	}
}
