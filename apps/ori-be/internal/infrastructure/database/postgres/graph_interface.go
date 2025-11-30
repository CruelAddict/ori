package postgres

import (
	"context"
	"fmt"

	"github.com/crueladdict/ori/apps/ori-server/internal/model"
)

// Bootstrap returns root nodes for the connection graph (schemas in PostgreSQL)
func (a *Adapter) Bootstrap(ctx context.Context) ([]*model.Node, error) {
	schemas, err := a.listSchemas(ctx)
	if err != nil {
		return nil, err
	}

	nodes := make([]*model.Node, 0, len(schemas))
	for _, schema := range schemas {
		attributes := map[string]any{
			"connection": a.connectionName,
			"database":   a.config.Database,
			"schema":     schema,
			"engine":     "postgresql",
		}
		node := &model.Node{
			ID:         a.schemaNodeID(a.connectionName, schema),
			Type:       "schema",
			Name:       schema,
			Attributes: attributes,
			Edges:      make(map[string]model.EdgeList),
			Hydrated:   false,
		}
		nodes = append(nodes, node)
	}

	if len(nodes) == 0 {
		return nil, fmt.Errorf("no schemas found for postgresql configuration '%s'", a.connectionName)
	}
	return nodes, nil
}

// Hydrate enriches the provided node with edges and discovers its descendants.
func (a *Adapter) Hydrate(ctx context.Context, target *model.Node) ([]*model.Node, error) {
	switch target.Type {
	case "schema":
		return a.hydrateSchema(ctx, target)
	case "table", "view":
		return a.hydrateTable(ctx, target)
	default:
		return []*model.Node{target}, nil
	}
}
