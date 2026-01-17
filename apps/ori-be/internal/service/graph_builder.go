package service

import (
	"maps"
	"sort"

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

// IndexNodeID generates a unique ID for an index node.
func (b *GraphBuilder) IndexNodeID(scope model.ScopeID, relation, indexName string) string {
	if scope.Schema == nil {
		return stringutil.Slug(b.engine, b.connectionName, "index", scope.Database, relation, indexName)
	}
	return stringutil.Slug(b.engine, b.connectionName, "index", *scope.Schema, relation, indexName)
}

// TriggerNodeID generates a unique ID for a trigger node.
func (b *GraphBuilder) TriggerNodeID(scope model.ScopeID, relation, triggerName string) string {
	if scope.Schema == nil {
		return stringutil.Slug(b.engine, b.connectionName, "trigger", scope.Database, relation, triggerName)
	}
	return stringutil.Slug(b.engine, b.connectionName, "trigger", *scope.Schema, relation, triggerName)
}

// BuildScopeNode creates a node for a scope.
func (b *GraphBuilder) BuildScopeNode(scope model.Scope) *model.Node {
	var nodeType string
	attrs := map[string]any{
		"connection": b.connectionName,
		"engine":     b.engine,
	}

	var name string
	if scope.Schema == nil {
		nodeType = "database"
		name = scope.Database
	} else {
		nodeType = "schema"
		name = *scope.Schema
	}

	maps.Copy(attrs, scope.Attrs)

	return &model.Node{
		ID:         b.ScopeNodeID(scope.ScopeID),
		Type:       nodeType,
		Name:       name,
		Scope:      scope.ScopeID,
		Attributes: attrs,
		Edges:      make(map[string]model.EdgeList),
		Hydrated:   false,
	}
}

// BuildRelationNode creates a node for a table or view.
func (b *GraphBuilder) BuildRelationNode(scope model.ScopeID, rel model.Relation) *model.Node {
	attrs := map[string]any{
		"connection": b.connectionName,
		"table":      rel.Name,
		"tableType":  rel.Type,
	}

	if rel.Definition != "" {
		attrs["definition"] = rel.Definition
	}

	return &model.Node{
		ID:         b.RelationNodeID(scope, rel),
		Type:       rel.Type,
		Name:       rel.Name,
		Scope:      scope,
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
			"table":      relation,
			"column":     col.Name,
			"ordinal":    col.Ordinal,
			"dataType":   col.DataType,
			"notNull":    col.NotNull,
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
			Scope:      scope,
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
			"table":          relation,
			"constraintName": c.Name,
			"constraintType": c.Type,
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
			Name:       c.Name,
			Scope:      scope,
			Attributes: attrs,
			Edges:      make(map[string]model.EdgeList),
			Hydrated:   true,
		}
		nodes = append(nodes, node)
		edge.Items = append(edge.Items, node.ID)
	}

	return nodes, edge
}

// BuildIndexNodes creates nodes for table/view indexes.
func (b *GraphBuilder) BuildIndexNodes(scope model.ScopeID, relation string, indexes []model.Index) ([]*model.Node, model.EdgeList) {
	sorted := make([]model.Index, len(indexes))
	copy(sorted, indexes)
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].Name < sorted[j].Name
	})

	nodes := make([]*model.Node, 0, len(sorted))
	edge := model.EdgeList{Items: make([]string, 0, len(sorted))}

	for _, idx := range sorted {
		attrs := map[string]any{
			"connection": b.connectionName,
			"table":      relation,
			"indexName":  idx.Name,
			"unique":     idx.Unique,
			"primary":    idx.Primary,
		}

		if len(idx.Columns) > 0 {
			attrs["columns"] = stringutil.CopyStrings(idx.Columns)
		}
		if idx.Definition != "" {
			attrs["definition"] = idx.Definition
		}
		if idx.Method != "" {
			attrs["method"] = idx.Method
		}
		if idx.Predicate != "" {
			attrs["predicate"] = idx.Predicate
		}

		node := &model.Node{
			ID:         b.IndexNodeID(scope, relation, idx.Name),
			Type:       "index",
			Name:       idx.Name,
			Scope:      scope,
			Attributes: attrs,
			Edges:      make(map[string]model.EdgeList),
			Hydrated:   true,
		}
		nodes = append(nodes, node)
		edge.Items = append(edge.Items, node.ID)
	}

	return nodes, edge
}

// BuildTriggerNodes creates nodes for table/view triggers.
func (b *GraphBuilder) BuildTriggerNodes(scope model.ScopeID, relation string, triggers []model.Trigger) ([]*model.Node, model.EdgeList) {
	sorted := make([]model.Trigger, len(triggers))
	copy(sorted, triggers)
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].Name < sorted[j].Name
	})

	nodes := make([]*model.Node, 0, len(sorted))
	edge := model.EdgeList{Items: make([]string, 0, len(sorted))}

	for _, trg := range sorted {
		attrs := map[string]any{
			"connection":  b.connectionName,
			"table":       relation,
			"triggerName": trg.Name,
			"timing":      trg.Timing,
			"orientation": trg.Orientation,
		}

		if len(trg.Events) > 0 {
			attrs["events"] = stringutil.CopyStrings(trg.Events)
		}
		if trg.Statement != "" {
			attrs["statement"] = trg.Statement
		}
		if trg.Condition != "" {
			attrs["condition"] = trg.Condition
		}
		if trg.Enabled != nil {
			attrs["enabled"] = *trg.Enabled
		}
		if trg.Definition != "" {
			attrs["definition"] = trg.Definition
		}

		node := &model.Node{
			ID:         b.TriggerNodeID(scope, relation, trg.Name),
			Type:       "trigger",
			Name:       trg.Name,
			Scope:      scope,
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
