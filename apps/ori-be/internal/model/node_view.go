package model

import (
	"fmt"

	dto "github.com/crueladdict/ori/libs/contract/go"
)

type ViewNode struct {
	BaseNode
	Attributes  dto.ViewNodeAttributes
	Columns     []string
	Constraints []string
	Indexes     []string
	Triggers    []string
}

func (n *ViewNode) Clone() Node {
	if n == nil {
		return nil
	}
	clone := *n
	clone.BaseNode = n.cloneBase()
	clone.Attributes = cloneViewAttributes(n.Attributes)
	clone.Columns = cloneRelationIDs(n.Columns)
	clone.Constraints = cloneRelationIDs(n.Constraints)
	clone.Indexes = cloneRelationIDs(n.Indexes)
	clone.Triggers = cloneRelationIDs(n.Triggers)
	return &clone
}

func (n *ViewNode) SetColumns(columnIDs []string) {
	if n == nil {
		return
	}
	n.Columns = cloneStringSlice(columnIDs)
}

func (n *ViewNode) SetConstraints(constraintIDs []string) {
	if n == nil {
		return
	}
	n.Constraints = cloneStringSlice(constraintIDs)
}

func (n *ViewNode) SetIndexes(indexIDs []string) {
	if n == nil {
		return
	}
	n.Indexes = cloneStringSlice(indexIDs)
}

func (n *ViewNode) SetTriggers(triggerIDs []string) {
	if n == nil {
		return
	}
	n.Triggers = cloneStringSlice(triggerIDs)
}

func (n *ViewNode) RelationName() string {
	if n == nil {
		return ""
	}
	return n.Attributes.Table
}

func (node *ViewNode) ToDTO() (dto.Node, error) {
	if node == nil {
		return dto.Node{}, fmt.Errorf("view node is nil")
	}
	out := dto.Node{}
	err := out.FromViewNode(dto.ViewNode{
		Id:         node.GetID(),
		Name:       node.GetName(),
		Edges:      viewRelationsToDTO(node),
		Attributes: cloneViewAttributes(node.Attributes),
	})
	if err != nil {
		return dto.Node{}, fmt.Errorf("node %s: %w", node.GetID(), err)
	}
	return out, nil
}

func viewRelationsToDTO(node *ViewNode) map[string]dto.NodeEdge {
	if node == nil {
		return emptyRelationsToDTO()
	}
	out := make(map[string]dto.NodeEdge, 4)
	if node.IsHydrated() || len(node.Columns) > 0 {
		out[NodeRelationColumns] = relationToDTO(node.Columns)
	}
	if node.IsHydrated() || len(node.Constraints) > 0 {
		out[NodeRelationConstraints] = relationToDTO(node.Constraints)
	}
	if node.IsHydrated() || len(node.Indexes) > 0 {
		out[NodeRelationIndexes] = relationToDTO(node.Indexes)
	}
	if node.IsHydrated() || len(node.Triggers) > 0 {
		out[NodeRelationTriggers] = relationToDTO(node.Triggers)
	}
	if len(out) == 0 {
		return emptyRelationsToDTO()
	}
	return out
}
