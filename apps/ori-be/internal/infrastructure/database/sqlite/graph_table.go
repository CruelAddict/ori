package sqlite

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/crueladdict/ori/apps/ori-server/internal/model"
	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/stringutil"
)

type relationInfo struct {
	Name string
	Type string
	SQL  string
}

type columnInfo struct {
	CID          int
	Name         string
	DataType     string
	NotNull      bool
	DefaultValue sql.NullString
	PK           int
}

func (a *Adapter) tableNodeID(connectionName, dbName, tableName, relType string) string {
	return stringutil.Slug("sqlite", connectionName, relType, dbName, tableName)
}

func (a *Adapter) columnNodeID(connectionName, dbName, tableName, columnName string) string {
	return stringutil.Slug("sqlite", connectionName, "column", dbName, tableName, columnName)
}

func (a *Adapter) hydrateTable(ctx context.Context, target *model.Node) ([]*model.Node, error) {
	dbName, _ := target.Attributes["database"].(string)
	tableName, _ := target.Attributes["table"].(string)
	if dbName == "" || tableName == "" {
		return nil, fmt.Errorf("table node %s missing database/table attributes", target.ID)
	}

	cols, err := a.readTableColumns(ctx, dbName, tableName)
	if err != nil {
		return nil, err
	}
	columnNodes, columnEdge := a.buildColumnNodes(dbName, tableName, cols)

	constraintNodes, constraintEdge, err := a.buildConstraintNodes(ctx, dbName, tableName, cols)
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

func (a *Adapter) fetchRelations(ctx context.Context, schema, relType string) ([]relationInfo, error) {
	query := fmt.Sprintf(`SELECT name, type, COALESCE(sql, '') as sql FROM "%s".sqlite_master WHERE type = %s AND name NOT LIKE 'sqlite_%%' ORDER BY name`,
		stringutil.EscapeIdentifier(schema), stringutil.QuoteLiteral(relType))
	rows, err := a.db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []relationInfo
	for rows.Next() {
		var rel relationInfo
		if err := rows.Scan(&rel.Name, &rel.Type, &rel.SQL); err != nil {
			return nil, err
		}
		results = append(results, rel)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return results, nil
}

func (a *Adapter) buildRelationNode(dbName string, rel relationInfo) *model.Node {
	attributes := map[string]any{
		"connection": a.connectionName,
		"database":   dbName,
		"table":      rel.Name,
		"tableType":  rel.Type,
	}
	if rel.SQL != "" {
		attributes["definition"] = rel.SQL
	}
	return &model.Node{
		ID:         a.tableNodeID(a.connectionName, dbName, rel.Name, rel.Type),
		Type:       rel.Type,
		Name:       rel.Name,
		Attributes: attributes,
		Edges:      make(map[string]model.EdgeList),
		Hydrated:   false,
	}
}

func (a *Adapter) readTableColumns(ctx context.Context, schema, table string) ([]columnInfo, error) {
	query := fmt.Sprintf(`PRAGMA "%s".table_info(%s)`, stringutil.EscapeIdentifier(schema), stringutil.QuoteLiteral(table))
	rows, err := a.db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var columns []columnInfo
	for rows.Next() {
		var col columnInfo
		var notNull int
		if err := rows.Scan(&col.CID, &col.Name, &col.DataType, &notNull, &col.DefaultValue, &col.PK); err != nil {
			return nil, err
		}
		col.NotNull = notNull == 1
		columns = append(columns, col)
	}
	return columns, rows.Err()
}

func (a *Adapter) buildColumnNodes(dbName, tableName string, cols []columnInfo) ([]*model.Node, model.EdgeList) {
	nodes := make([]*model.Node, 0, len(cols))
	edge := model.EdgeList{Items: make([]string, 0, len(cols))}
	for _, col := range cols {
		attrs := map[string]any{
			"connection":         a.connectionName,
			"database":           dbName,
			"table":              tableName,
			"column":             col.Name,
			"ordinal":            col.CID,
			"dataType":           col.DataType,
			"notNull":            col.NotNull,
			"primaryKeyPosition": col.PK,
		}
		if col.DefaultValue.Valid {
			attrs["defaultValue"] = col.DefaultValue.String
		}
		node := &model.Node{
			ID:         a.columnNodeID(a.connectionName, dbName, tableName, col.Name),
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
