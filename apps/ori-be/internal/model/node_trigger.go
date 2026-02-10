package model

import (
	"fmt"

	dto "github.com/crueladdict/ori/libs/contract/go"
)

type TriggerNode struct {
	BaseNode
	Attributes dto.TriggerNodeAttributes
}

func (n *TriggerNode) Clone() Node {
	if n == nil {
		return nil
	}
	clone := *n
	clone.BaseNode = n.cloneBase()
	clone.Attributes = cloneTriggerAttributes(n.Attributes)
	return &clone
}

func (node *TriggerNode) ToDTO() (dto.Node, error) {
	if node == nil {
		return dto.Node{}, fmt.Errorf("trigger node is nil")
	}
	out := dto.Node{}
	err := out.FromTriggerNode(dto.TriggerNode{
		Id:         node.GetID(),
		Name:       node.GetName(),
		Edges:      emptyRelationsToDTO(),
		Attributes: cloneTriggerAttributes(node.Attributes),
	})
	if err != nil {
		return dto.Node{}, fmt.Errorf("node %s: %w", node.GetID(), err)
	}
	return out, nil
}
