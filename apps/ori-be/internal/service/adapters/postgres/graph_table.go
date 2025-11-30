package postgres

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/crueladdict/ori/apps/ori-server/internal/model"
)

type relationInfo struct {
	Name       string
	Type       string
	Definition sql.NullString
}

type columnInfo struct {
	Name             string
	OrdinalPosition  int
	DataType         string
	IsNullable       bool
	DefaultValue     sql.NullString
	CharMaxLength    sql.NullInt64
	NumericPrecision sql.NullInt64
	NumericScale     sql.NullInt64
}

// tableNodeID generates a unique ID for a table/view node
func (a *Adapter) tableNodeID(connectionName, schemaName, tableName, relType string) string {
	nodeType := "table"
	if relType == "VIEW" {
		nodeType = "view"
	}
	return slug("postgres", connectionName, nodeType, schemaName, tableName)
}

// columnNodeID generates a unique ID for a column node
func (a *Adapter) columnNodeID(connectionName, schemaName, tableName, columnName string) string {
	return slug("postgres", connectionName, "column", schemaName, tableName, columnName)
}

// fetchRelations retrieves tables or views from a schema
func (a *Adapter) fetchRelations(ctx context.Context, schemaName, relType string) ([]relationInfo, error) {
	query := `
		SELECT 
			t.table_name,
			t.table_type,
			v.view_definition
		FROM information_schema.tables t
		LEFT JOIN information_schema.views v 
			ON t.table_schema = v.table_schema AND t.table_name = v.table_name
		WHERE t.table_schema = $1 AND t.table_type = $2
		ORDER BY t.table_name
	`
	rows, err := a.db.QueryContext(ctx, query, schemaName, relType)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch relations: %w", err)
	}
	defer rows.Close()

	var results []relationInfo
	for rows.Next() {
		var rel relationInfo
		if err := rows.Scan(&rel.Name, &rel.Type, &rel.Definition); err != nil {
			return nil, fmt.Errorf("failed to scan relation: %w", err)
		}
		results = append(results, rel)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating relations: %w", err)
	}
	return results, nil
}

// buildRelationNode creates a node for a table or view
func (a *Adapter) buildRelationNode(schemaName string, rel relationInfo) *model.Node {
	nodeType := "table"
	if rel.Type == "VIEW" {
		nodeType = "view"
	}

	attributes := map[string]any{
		"connection": a.connectionName,
		"database":   a.config.Database,
		"schema":     schemaName,
		"table":      rel.Name,
		"tableType":  rel.Type,
	}
	if rel.Definition.Valid && rel.Definition.String != "" {
		attributes["definition"] = rel.Definition.String
	}

	return &model.Node{
		ID:         a.tableNodeID(a.connectionName, schemaName, rel.Name, rel.Type),
		Type:       nodeType,
		Name:       rel.Name,
		Attributes: attributes,
		Edges:      make(map[string]model.EdgeList),
		Hydrated:   false,
	}
}

// hydrateTable discovers columns and constraints for a table or view
func (a *Adapter) hydrateTable(ctx context.Context, target *model.Node) ([]*model.Node, error) {
	schemaName, _ := target.Attributes["schema"].(string)
	tableName, _ := target.Attributes["table"].(string)
	if schemaName == "" || tableName == "" {
		return nil, fmt.Errorf("table node %s missing schema/table attributes", target.ID)
	}

	cols, err := a.readTableColumns(ctx, schemaName, tableName)
	if err != nil {
		return nil, err
	}
	columnNodes, columnEdge := a.buildColumnNodes(schemaName, tableName, cols)

	constraintNodes, constraintEdge, err := a.buildConstraintNodes(ctx, schemaName, tableName)
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

// readTableColumns retrieves column information for a table
func (a *Adapter) readTableColumns(ctx context.Context, schemaName, tableName string) ([]columnInfo, error) {
	query := `
		SELECT 
			column_name,
			ordinal_position,
			data_type,
			CASE WHEN is_nullable = 'YES' THEN true ELSE false END as is_nullable,
			column_default,
			character_maximum_length,
			numeric_precision,
			numeric_scale
		FROM information_schema.columns
		WHERE table_schema = $1 AND table_name = $2
		ORDER BY ordinal_position
	`
	rows, err := a.db.QueryContext(ctx, query, schemaName, tableName)
	if err != nil {
		return nil, fmt.Errorf("failed to read columns: %w", err)
	}
	defer rows.Close()

	var columns []columnInfo
	for rows.Next() {
		var col columnInfo
		if err := rows.Scan(
			&col.Name,
			&col.OrdinalPosition,
			&col.DataType,
			&col.IsNullable,
			&col.DefaultValue,
			&col.CharMaxLength,
			&col.NumericPrecision,
			&col.NumericScale,
		); err != nil {
			return nil, fmt.Errorf("failed to scan column: %w", err)
		}
		columns = append(columns, col)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating columns: %w", err)
	}
	return columns, nil
}

// buildColumnNodes creates nodes for table columns
func (a *Adapter) buildColumnNodes(schemaName, tableName string, cols []columnInfo) ([]*model.Node, model.EdgeList) {
	nodes := make([]*model.Node, 0, len(cols))
	edge := model.EdgeList{Items: make([]string, 0, len(cols))}

	for _, col := range cols {
		attrs := map[string]any{
			"connection": a.connectionName,
			"database":   a.config.Database,
			"schema":     schemaName,
			"table":      tableName,
			"column":     col.Name,
			"ordinal":    col.OrdinalPosition,
			"dataType":   col.DataType,
			"notNull":    !col.IsNullable,
		}
		if col.DefaultValue.Valid {
			attrs["defaultValue"] = col.DefaultValue.String
		}
		if col.CharMaxLength.Valid {
			attrs["charMaxLength"] = col.CharMaxLength.Int64
		}
		if col.NumericPrecision.Valid {
			attrs["numericPrecision"] = col.NumericPrecision.Int64
		}
		if col.NumericScale.Valid {
			attrs["numericScale"] = col.NumericScale.Int64
		}

		node := &model.Node{
			ID:         a.columnNodeID(a.connectionName, schemaName, tableName, col.Name),
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
