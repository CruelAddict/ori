package model

import (
	"fmt"

	dto "github.com/crueladdict/ori/libs/contract/go"
)

type ColumnNode struct {
	BaseNode
	Attributes dto.ColumnNodeAttributes
}

func (n *ColumnNode) Clone() Node {
	if n == nil {
		return nil
	}
	clone := *n
	clone.BaseNode = n.cloneBase()
	clone.Attributes = cloneColumnAttributes(n.Attributes)
	return &clone
}

func (node *ColumnNode) ToDTO() (dto.Node, error) {
	if node == nil {
		return dto.Node{}, fmt.Errorf("column node is nil")
	}
	out := dto.Node{}
	err := out.FromColumnNode(dto.ColumnNode{
		Id:         node.GetID(),
		Name:       node.GetName(),
		Edges:      map[string]dto.NodeEdge{},
		Attributes: cloneColumnAttributes(node.Attributes),
	})
	if err != nil {
		return dto.Node{}, fmt.Errorf("node %s: %w", node.GetID(), err)
	}
	return out, nil
}
