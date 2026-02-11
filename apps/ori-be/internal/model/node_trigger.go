package model

import (
	"fmt"

	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/cloneutil"
	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/stringutil"
	dto "github.com/crueladdict/ori/libs/contract/go"
)

type TriggerNode struct {
	BaseNode
	Condition    *string
	Connection   string
	Definition   *string
	EnabledState *string
	Events       *[]string
	Orientation  string
	Statement    *string
	Table        string
	Timing       string
	TriggerName  string
}

func NewTriggerNode(engine, connectionName string, scope ScopeID, relation string, trg Trigger) *TriggerNode {
	id := stringutil.Slug(engine, connectionName, "trigger", scope.Database, relation, trg.Name)
	if scope.Schema != nil {
		id = stringutil.Slug(engine, connectionName, "trigger", *scope.Schema, relation, trg.Name)
	}

	return &TriggerNode{
		BaseNode: BaseNode{
			ID:       id,
			Name:     trg.Name,
			Scope:    scope,
			Hydrated: true,
		},
		Connection:   connectionName,
		Table:        relation,
		TriggerName:  trg.Name,
		Timing:       trg.Timing,
		Orientation:  trg.Orientation,
		Events:       cloneutil.SlicePtrIfNotEmpty(trg.Events),
		Statement:    stringPtrIfNotEmpty(trg.Statement),
		Condition:    stringPtrIfNotEmpty(trg.Condition),
		EnabledState: stringPtrIfNotEmpty(trg.EnabledState),
		Definition:   stringPtrIfNotEmpty(trg.Definition),
	}
}

func (n *TriggerNode) Clone() Node {
	if n == nil {
		return nil
	}
	clone := *n
	clone.BaseNode = n.cloneBase()
	clone.Condition = cloneutil.Ptr(n.Condition)
	clone.Definition = cloneutil.Ptr(n.Definition)
	clone.EnabledState = cloneutil.Ptr(n.EnabledState)
	clone.Events = cloneutil.SlicePtr(n.Events)
	clone.Statement = cloneutil.Ptr(n.Statement)
	return &clone
}

func (node *TriggerNode) ToDTO() (dto.Node, error) {
	if node == nil {
		return dto.Node{}, fmt.Errorf("trigger node is nil")
	}
	out := dto.Node{}
	err := out.FromTriggerNode(dto.TriggerNode{
		Id:    node.GetID(),
		Name:  node.GetName(),
		Edges: map[string]dto.NodeEdge{},
		Attributes: dto.TriggerNodeAttributes{
			Condition:    node.Condition,
			Connection:   node.Connection,
			Definition:   node.Definition,
			EnabledState: node.EnabledState,
			Events:       node.Events,
			Orientation:  node.Orientation,
			Statement:    node.Statement,
			Table:        node.Table,
			Timing:       node.Timing,
			TriggerName:  node.TriggerName,
		},
	})
	if err != nil {
		return dto.Node{}, fmt.Errorf("node %s: %w", node.GetID(), err)
	}
	return out, nil
}
