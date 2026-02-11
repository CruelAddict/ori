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
		Edges:      map[string]dto.NodeEdge{},
		Attributes: node.Attributes,
	})
	if err != nil {
		return dto.Node{}, fmt.Errorf("node %s: %w", node.GetID(), err)
	}
	return out, nil
}

func cloneTriggerAttributes(attrs dto.TriggerNodeAttributes) dto.TriggerNodeAttributes {
	return dto.TriggerNodeAttributes{
		Condition:    cloneutil.Ptr(attrs.Condition),
		Connection:   attrs.Connection,
		Definition:   cloneutil.Ptr(attrs.Definition),
		EnabledState: cloneutil.Ptr(attrs.EnabledState),
		Events:       cloneutil.SlicePtr(attrs.Events),
		Orientation:  attrs.Orientation,
		Statement:    cloneutil.Ptr(attrs.Statement),
		Table:        attrs.Table,
		Timing:       attrs.Timing,
		TriggerName:  attrs.TriggerName,
	}
}
