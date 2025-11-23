package sqlite

import (
	"context"
	"fmt"
	"strings"

	"github.com/crueladdict/ori/apps/ori-server/internal/model"
)

// Bootstrap returns root nodes for the connection graph
func (a *Adapter) Bootstrap(ctx context.Context) ([]*model.Node, error) {
	entries, err := a.listDatabases(ctx)
	if err != nil {
		return nil, err
	}
	nodes := make([]*model.Node, 0, len(entries))
	for _, entry := range entries {
		if strings.EqualFold(entry.Name, "temp") {
			continue
		}
		attributes := map[string]any{
			"connection": a.connectionName,
			"database":   entry.Name,
			"file":       entry.File,
			"sequence":   entry.Seq,
			"engine":     "sqlite",
		}
		if pageSize, err := a.pragmaInt(ctx, entry.Name, "page_size"); err == nil {
			attributes["pageSize"] = pageSize
		}
		if encoding, err := a.pragmaText(ctx, entry.Name, "encoding"); err == nil && encoding != "" {
			attributes["encoding"] = encoding
		}
		node := &model.Node{
			ID:         a.databaseNodeID(a.connectionName, entry.Name),
			Type:       "database",
			Name:       a.databaseDisplayName(a.connectionName, entry.Name, entry.File),
			Attributes: attributes,
			Edges:      make(map[string]model.EdgeList),
			Hydrated:   false,
		}
		nodes = append(nodes, node)
	}
	if len(nodes) == 0 {
		return nil, fmt.Errorf("no sqlite databases found for configuration '%s'", a.connectionName)
	}
	return nodes, nil
}

// Hydrate enriches the provided node with edges and discovers its descendants.
func (a *Adapter) Hydrate(ctx context.Context, target *model.Node) ([]*model.Node, error) {
	switch target.Type {
	case "database":
		return a.hydrateDatabase(ctx, target)
	case "table", "view":
		return a.hydrateTable(ctx, target)
	default:
		return []*model.Node{target}, nil
	}
}

func (a *Adapter) databaseDisplayName(connectionName, dbName, file string) string {
	return dbName
}

func (a *Adapter) pragmaInt(ctx context.Context, schema, pragma string) (int64, error) {
	query := fmt.Sprintf(`PRAGMA "%s".%s`, escapeIdentifier(schema), pragma)
	var value int64
	err := a.db.QueryRowContext(ctx, query).Scan(&value)
	return value, err
}

func (a *Adapter) pragmaText(ctx context.Context, schema, pragma string) (string, error) {
	query := fmt.Sprintf(`PRAGMA "%s".%s`, escapeIdentifier(schema), pragma)
	var value string
	err := a.db.QueryRowContext(ctx, query).Scan(&value)
	return value, err
}
