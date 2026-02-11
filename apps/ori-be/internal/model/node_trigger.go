package model

import (
	"fmt"

	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/cloneutil"
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
	clone.Attributes = dto.TriggerNodeAttributes{
		Condition:    cloneutil.Ptr(n.Attributes.Condition),
		Connection:   n.Attributes.Connection,
		Definition:   cloneutil.Ptr(n.Attributes.Definition),
		EnabledState: cloneutil.Ptr(n.Attributes.EnabledState),
		Events:       cloneutil.SlicePtr(n.Attributes.Events),
		Orientation:  n.Attributes.Orientation,
		Statement:    cloneutil.Ptr(n.Attributes.Statement),
		Table:        n.Attributes.Table,
		Timing:       n.Attributes.Timing,
		TriggerName:  n.Attributes.TriggerName,
	}
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
		Edges:      map[string]dto.NodeEdge{},
		Attributes: node.Attributes,
	})
	if err != nil {
		return dto.Node{}, fmt.Errorf("node %s: %w", node.GetID(), err)
	}
	return out, nil
}
