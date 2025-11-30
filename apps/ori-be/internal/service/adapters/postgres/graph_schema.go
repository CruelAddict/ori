package postgres

import (
	"context"
	"fmt"

	"github.com/crueladdict/ori/apps/ori-server/internal/model"
)

// schemaNodeID generates a unique ID for a schema node
func (a *Adapter) schemaNodeID(connectionName, schemaName string) string {
	return slug("postgres", connectionName, "schema", schemaName)
}

// listSchemas returns all non-system schemas in the database
func (a *Adapter) listSchemas(ctx context.Context) ([]string, error) {
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
	defer rows.Close()

	var schemas []string
	for rows.Next() {
		var schema string
		if err := rows.Scan(&schema); err != nil {
			return nil, fmt.Errorf("failed to scan schema: %w", err)
		}
		schemas = append(schemas, schema)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating schemas: %w", err)
	}
	return schemas, nil
}

// hydrateSchema discovers tables and views within a schema
func (a *Adapter) hydrateSchema(ctx context.Context, target *model.Node) ([]*model.Node, error) {
	schemaName, _ := target.Attributes["schema"].(string)
	if schemaName == "" {
		return nil, fmt.Errorf("schema node %s missing 'schema' attribute", target.ID)
	}

	tables, err := a.fetchRelations(ctx, schemaName, "BASE TABLE")
	if err != nil {
		return nil, err
	}
	views, err := a.fetchRelations(ctx, schemaName, "VIEW")
	if err != nil {
		return nil, err
	}

	childNodes := []*model.Node{target}
	tableEdge := model.EdgeList{Items: make([]string, 0, len(tables))}
	viewEdge := model.EdgeList{Items: make([]string, 0, len(views))}

	for _, rel := range tables {
		relNode := a.buildRelationNode(schemaName, rel)
		childNodes = append(childNodes, relNode)
		tableEdge.Items = append(tableEdge.Items, relNode.ID)
	}
	for _, rel := range views {
		relNode := a.buildRelationNode(schemaName, rel)
		childNodes = append(childNodes, relNode)
		viewEdge.Items = append(viewEdge.Items, relNode.ID)
	}

	target.Edges["tables"] = tableEdge
	target.Edges["views"] = viewEdge
	target.Hydrated = true
	return childNodes, nil
}
