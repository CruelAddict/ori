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
		return map[string]dto.NodeEdge{}
	}
	out := map[string]dto.NodeEdge{}
	out[NodeRelationColumns] = relationToDTO(node.Columns)
	out[NodeRelationConstraints] = relationToDTO(node.Constraints)
	out[NodeRelationIndexes] = relationToDTO(node.Indexes)
	out[NodeRelationTriggers] = relationToDTO(node.Triggers)
	return out
}
