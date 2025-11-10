package sqlite

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/crueladdict/ori/apps/ori-server/internal/model"
)

type databaseEntry struct {
	Seq  int
	Name string
	File string
}

func (a *Adapter) databaseNodeID(connectionName, dbName string) string {
	return slug("sqlite", connectionName, "database", dbName)
}

func (a *Adapter) listDatabases(ctx context.Context) ([]databaseEntry, error) {
	rows, err := a.db.QueryContext(ctx, "PRAGMA database_list")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []databaseEntry
	for rows.Next() {
		var entry databaseEntry
		var file sql.NullString
		if err := rows.Scan(&entry.Seq, &entry.Name, &file); err != nil {
			return nil, err
		}
		entry.File = file.String
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}

func (a *Adapter) hydrateDatabase(ctx context.Context, target *model.Node) ([]*model.Node, error) {
	dbName, _ := target.Attributes["database"].(string)
	if dbName == "" {
		return nil, fmt.Errorf("database node %s missing 'database' attribute", target.ID)
	}

	tables, err := a.fetchRelations(ctx, dbName, "table")
	if err != nil {
		return nil, err
	}
	views, err := a.fetchRelations(ctx, dbName, "view")
	if err != nil {
		return nil, err
	}

	childNodes := []*model.Node{target}
	tableEdge := model.EdgeList{Items: make([]string, 0, len(tables))}
	viewEdge := model.EdgeList{Items: make([]string, 0, len(views))}

	for _, rel := range tables {
		relNode := a.buildRelationNode(dbName, rel)
		childNodes = append(childNodes, relNode)
		tableEdge.Items = append(tableEdge.Items, relNode.ID)
	}
	for _, rel := range views {
		relNode := a.buildRelationNode(dbName, rel)
		childNodes = append(childNodes, relNode)
		viewEdge.Items = append(viewEdge.Items, relNode.ID)
	}

	target.Edges["tables"] = tableEdge
	target.Edges["views"] = viewEdge
	target.Hydrated = true
	return childNodes, nil
}
