package model

import (
	"fmt"

	dto "github.com/crueladdict/ori/libs/contract/go"
)

type ConstraintNode struct {
	BaseNode
	Attributes dto.ConstraintNodeAttributes
}

func (n *ConstraintNode) Clone() Node {
	if n == nil {
		return nil
	}
	clone := *n
	clone.BaseNode = n.cloneBase()
	clone.Attributes = cloneConstraintAttributes(n.Attributes)
	return &clone
}

func (node *ConstraintNode) ToDTO() (dto.Node, error) {
	if node == nil {
		return dto.Node{}, fmt.Errorf("constraint node is nil")
	}
	out := dto.Node{}
	err := out.FromConstraintNode(dto.ConstraintNode{
		Id:         node.GetID(),
		Name:       node.GetName(),
		Edges:      emptyRelationsToDTO(),
		Attributes: cloneConstraintAttributes(node.Attributes),
	})
	if err != nil {
		return dto.Node{}, fmt.Errorf("node %s: %w", node.GetID(), err)
	}
	return out, nil
}
