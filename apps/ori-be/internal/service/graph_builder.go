package service

import (
	"sort"

	"github.com/crueladdict/ori/apps/ori-server/internal/model"
)

// GraphBuilder converts relational metadata into graph nodes.
type GraphBuilder struct{}

// NewGraphBuilder creates a graph builder for a connection.
func NewGraphBuilder(handle *ConnectionHandle) *GraphBuilder {
	_ = handle
	return &GraphBuilder{}
}

// BuildScopeNode creates a node for a scope.
func (b *GraphBuilder) BuildScopeNode(scope model.Scope) model.Node {
	return scope.NewRootNode()
}

// BuildRelationNode creates a node for a table or view.
func (b *GraphBuilder) BuildRelationNode(scope model.Scope, rel model.Relation) model.Node {
	return model.NewRelationNode(scope, rel)
}

// BuildColumnNodes creates nodes for table columns.
func (b *GraphBuilder) BuildColumnNodes(scope model.Scope, relation string, columns []model.Column) ([]model.Node, []string) {
	nodes := make([]model.Node, 0, len(columns))
	columnIDs := make([]string, 0, len(columns))

	for _, col := range columns {
		node := model.NewColumnNode(scope, relation, col)
		nodes = append(nodes, node)
		columnIDs = append(columnIDs, node.GetID())
	}

	return nodes, columnIDs
}

// BuildConstraintNodes creates nodes for table constraints.
func (b *GraphBuilder) BuildConstraintNodes(scope model.Scope, relation string, constraints []model.Constraint) ([]model.Node, []string) {
	sort.Slice(constraints, func(i, j int) bool {
		if constraints[i].Type != constraints[j].Type {
			return constraintTypeOrder(constraints[i].Type) < constraintTypeOrder(constraints[j].Type)
		}
		return constraints[i].Name < constraints[j].Name
	})

	nodes := make([]model.Node, 0, len(constraints))
	constraintIDs := make([]string, 0, len(constraints))

	for _, c := range constraints {
		node := model.NewConstraintNode(scope, relation, c)
		nodes = append(nodes, node)
		constraintIDs = append(constraintIDs, node.GetID())
	}

	return nodes, constraintIDs
}

// BuildIndexNodes creates nodes for table/view indexes.
func (b *GraphBuilder) BuildIndexNodes(scope model.Scope, relation string, indexes []model.Index) ([]model.Node, []string) {
	sort.Slice(indexes, func(i, j int) bool {
		return indexes[i].Name < indexes[j].Name
	})

	nodes := make([]model.Node, 0, len(indexes))
	indexIDs := make([]string, 0, len(indexes))

	for _, idx := range indexes {
		node := model.NewIndexNode(scope, relation, idx)
		nodes = append(nodes, node)
		indexIDs = append(indexIDs, node.GetID())
	}

	return nodes, indexIDs
}

// BuildTriggerNodes creates nodes for table/view triggers.
func (b *GraphBuilder) BuildTriggerNodes(scope model.Scope, relation string, triggers []model.Trigger) ([]model.Node, []string) {
	sort.Slice(triggers, func(i, j int) bool {
		return triggers[i].Name < triggers[j].Name
	})

	nodes := make([]model.Node, 0, len(triggers))
	triggerIDs := make([]string, 0, len(triggers))

	for _, trg := range triggers {
		node := model.NewTriggerNode(scope, relation, trg)
		nodes = append(nodes, node)
		triggerIDs = append(triggerIDs, node.GetID())
	}

	return nodes, triggerIDs
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
