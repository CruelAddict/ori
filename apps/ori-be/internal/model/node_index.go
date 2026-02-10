package model

import (
	"fmt"

	dto "github.com/crueladdict/ori/libs/contract/go"
)

type IndexNode struct {
	BaseNode
	Attributes dto.IndexNodeAttributes
}

func (n *IndexNode) Clone() Node {
	if n == nil {
		return nil
	}
	clone := *n
	clone.BaseNode = n.cloneBase()
	clone.Attributes = cloneIndexAttributes(n.Attributes)
	return &clone
}

func (node *IndexNode) ToDTO() (dto.Node, error) {
	if node == nil {
		return dto.Node{}, fmt.Errorf("index node is nil")
	}
	out := dto.Node{}
	err := out.FromIndexNode(dto.IndexNode{
		Id:         node.GetID(),
		Name:       node.GetName(),
		Edges:      emptyRelationsToDTO(),
		Attributes: cloneIndexAttributes(node.Attributes),
	})
	if err != nil {
		return dto.Node{}, fmt.Errorf("node %s: %w", node.GetID(), err)
	}
	return out, nil
}
