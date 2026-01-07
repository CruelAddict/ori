package service

import (
	"fmt"
	"sort"
	"strings"

	"github.com/crueladdict/ori/apps/ori-server/internal/model"
	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/stringutil"
)

// GraphBuilder converts relational metadata into graph nodes.
type GraphBuilder struct {
	engine         string
	connectionName string
}

// NewGraphBuilder creates a graph builder for a connection.
func NewGraphBuilder(handle *ConnectionHandle) *GraphBuilder {
	return &GraphBuilder{
		engine:         handle.Configuration.Type,
		connectionName: handle.Name,
	}
}

// ScopeNodeID generates a unique ID for a scope node.
func (b *GraphBuilder) ScopeNodeID(scope model.ScopeID) string {
	if scope.Schema == nil {
		return stringutil.Slug(b.engine, b.connectionName, "database", scope.Database)
	}
	return stringutil.Slug(b.engine, b.connectionName, "schema", *scope.Schema)
}

// RelationNodeID generates a unique ID for a table/view node.
func (b *GraphBuilder) RelationNodeID(scope model.ScopeID, rel model.Relation) string {
	nodeType := rel.Type
	if scope.Schema == nil {
		return stringutil.Slug(b.engine, b.connectionName, nodeType, scope.Database, rel.Name)
	}
	return stringutil.Slug(b.engine, b.connectionName, nodeType, *scope.Schema, rel.Name)
}

// ColumnNodeID generates a unique ID for a column node.
func (b *GraphBuilder) ColumnNodeID(scope model.ScopeID, relation, column string) string {
	if scope.Schema == nil {
		return stringutil.Slug(b.engine, b.connectionName, "column", scope.Database, relation, column)
	}
	return stringutil.Slug(b.engine, b.connectionName, "column", *scope.Schema, relation, column)
}

// ConstraintNodeID generates a unique ID for a constraint node.
func (b *GraphBuilder) ConstraintNodeID(scope model.ScopeID, relation, constraintName string) string {
	if scope.Schema == nil {
		return stringutil.Slug(b.engine, b.connectionName, "constraint", scope.Database, relation, constraintName)
	}
	return stringutil.Slug(b.engine, b.connectionName, "constraint", *scope.Schema, relation, constraintName)
}

// BuildScopeNode creates a node for a scope.
func (b *GraphBuilder) BuildScopeNode(scope model.Scope) *model.Node {
	var nodeType string
	attrs := map[string]any{
		"connection": b.connectionName,
		"engine":     b.engine,
		"database":   scope.Database,
	}

	var name string
	if scope.Schema == nil {
		nodeType = "database"
		name = scope.Database
	} else {
		nodeType = "schema"
		attrs["schema"] = *scope.Schema
		name = *scope.Schema
	}

	for k, v := range scope.Attrs {
		attrs[k] = v
	}

	return &model.Node{
		ID:         b.ScopeNodeID(scope.ScopeID),
		Type:       nodeType,
		Name:       name,
		Attributes: attrs,
		Edges:      make(map[string]model.EdgeList),
		Hydrated:   false,
	}
}

// BuildRelationNode creates a node for a table or view.
func (b *GraphBuilder) BuildRelationNode(scope model.ScopeID, rel model.Relation) *model.Node {
	attrs := map[string]any{
		"connection": b.connectionName,
		"database":   scope.Database,
		"table":      rel.Name,
		"tableType":  rel.Type,
	}

	if scope.Schema != nil {
		attrs["schema"] = *scope.Schema
	}

	if rel.Definition != "" {
		attrs["definition"] = rel.Definition
	}

	return &model.Node{
		ID:         b.RelationNodeID(scope, rel),
		Type:       rel.Type,
		Name:       rel.Name,
		Attributes: attrs,
		Edges:      make(map[string]model.EdgeList),
		Hydrated:   false,
	}
}

// BuildColumnNodes creates nodes for table columns.
func (b *GraphBuilder) BuildColumnNodes(scope model.ScopeID, relation string, columns []model.Column) ([]*model.Node, model.EdgeList) {
	nodes := make([]*model.Node, 0, len(columns))
	edge := model.EdgeList{Items: make([]string, 0, len(columns))}

	for _, col := range columns {
		attrs := map[string]any{
			"connection": b.connectionName,
			"database":   scope.Database,
			"table":      relation,
			"column":     col.Name,
			"ordinal":    col.Ordinal,
			"dataType":   col.DataType,
			"notNull":    col.NotNull,
		}

		if scope.Schema != nil {
			attrs["schema"] = *scope.Schema
		}
		if col.DefaultValue != nil {
			attrs["defaultValue"] = *col.DefaultValue
		}
		if col.PrimaryKeyPos > 0 {
			attrs["primaryKeyPosition"] = col.PrimaryKeyPos
		}
		if col.CharMaxLength != nil {
			attrs["charMaxLength"] = *col.CharMaxLength
		}
		if col.NumericPrecision != nil {
			attrs["numericPrecision"] = *col.NumericPrecision
		}
		if col.NumericScale != nil {
			attrs["numericScale"] = *col.NumericScale
		}

		node := &model.Node{
			ID:         b.ColumnNodeID(scope, relation, col.Name),
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

// BuildConstraintNodes creates nodes for table constraints.
func (b *GraphBuilder) BuildConstraintNodes(scope model.ScopeID, relation string, constraints []model.Constraint) ([]*model.Node, model.EdgeList) {
	sorted := make([]model.Constraint, len(constraints))
	copy(sorted, constraints)
	sort.Slice(sorted, func(i, j int) bool {
		if sorted[i].Type != sorted[j].Type {
			return constraintTypeOrder(sorted[i].Type) < constraintTypeOrder(sorted[j].Type)
		}
		return sorted[i].Name < sorted[j].Name
	})

	nodes := make([]*model.Node, 0, len(sorted))
	edge := model.EdgeList{Items: make([]string, 0, len(sorted))}

	for _, c := range sorted {
		attrs := map[string]any{
			"connection":     b.connectionName,
			"database":       scope.Database,
			"table":          relation,
			"constraintName": c.Name,
			"constraintType": c.Type,
		}

		if scope.Schema != nil {
			attrs["schema"] = *scope.Schema
		}

		if len(c.Columns) > 0 {
			attrs["columns"] = stringutil.CopyStrings(c.Columns)
		}

		if c.Type == "FOREIGN KEY" {
			attrs["referencedTable"] = c.ReferencedTable
			if c.ReferencedScope != nil {
				attrs["referencedDatabase"] = c.ReferencedScope.Database
				if c.ReferencedScope.Schema != nil {
					attrs["referencedSchema"] = *c.ReferencedScope.Schema
				}
			}
			if len(c.ReferencedColumns) > 0 {
				attrs["referencedColumns"] = stringutil.CopyStrings(c.ReferencedColumns)
			}
			if c.OnUpdate != "" {
				attrs["onUpdate"] = c.OnUpdate
			}
			if c.OnDelete != "" {
				attrs["onDelete"] = c.OnDelete
			}
			if c.Match != "" {
				attrs["match"] = c.Match
			}
		}

		if c.UnderlyingIndex != nil {
			attrs["indexName"] = *c.UnderlyingIndex
		}

		if c.CheckClause != "" {
			attrs["checkClause"] = c.CheckClause
		}

		node := &model.Node{
			ID:         b.ConstraintNodeID(scope, relation, c.Name),
			Type:       "constraint",
			Name:       constraintDisplayName(c),
			Attributes: attrs,
			Edges:      make(map[string]model.EdgeList),
			Hydrated:   true,
		}
		nodes = append(nodes, node)
		edge.Items = append(edge.Items, node.ID)
	}

	return nodes, edge
}

func constraintTypeOrder(t string) int {
	switch t {
	case "PRIMARY KEY":
		return 0
	case "UNIQUE":
		return 1
	case "FOREIGN KEY":
		return 2
	case "CHECK":
		return 3
	default:
		return 4
	}
}

func constraintDisplayName(c model.Constraint) string {
	switch c.Type {
	case "PRIMARY KEY":
		return fmt.Sprintf("PRIMARY KEY on %s", strings.Join(c.Columns, ", "))
	case "UNIQUE":
		return fmt.Sprintf("UNIQUE %s", c.Name)
	case "FOREIGN KEY":
		return fmt.Sprintf("FOREIGN KEY referencing %s", c.ReferencedTable)
	case "CHECK":
		return fmt.Sprintf("CHECK %s", c.Name)
	default:
		return c.Name
	}
}
