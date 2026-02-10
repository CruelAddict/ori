package model

import (
	"fmt"

	dto "github.com/crueladdict/ori/libs/contract/go"
)

type ViewNode struct {
	BaseNode
	Attributes           dto.ViewNodeAttributes
	Columns              []string
	ColumnsLoaded        bool
	ColumnsTruncated     bool
	Constraints          []string
	ConstraintsLoaded    bool
	ConstraintsTruncated bool
	Indexes              []string
	IndexesLoaded        bool
	IndexesTruncated     bool
	Triggers             []string
	TriggersLoaded       bool
	TriggersTruncated    bool
}

func (n *ViewNode) Clone() Node {
	if n == nil {
		return nil
	}
	clone := *n
	clone.BaseNode = n.cloneBase()
	clone.Attributes = cloneViewAttributes(n.Attributes)
	clone.Columns, clone.ColumnsLoaded, clone.ColumnsTruncated = cloneRelationIDs(n.Columns, n.ColumnsLoaded, n.ColumnsTruncated)
	clone.Constraints, clone.ConstraintsLoaded, clone.ConstraintsTruncated = cloneRelationIDs(n.Constraints, n.ConstraintsLoaded, n.ConstraintsTruncated)
	clone.Indexes, clone.IndexesLoaded, clone.IndexesTruncated = cloneRelationIDs(n.Indexes, n.IndexesLoaded, n.IndexesTruncated)
	clone.Triggers, clone.TriggersLoaded, clone.TriggersTruncated = cloneRelationIDs(n.Triggers, n.TriggersLoaded, n.TriggersTruncated)
	return &clone
}

func (n *ViewNode) SetColumns(columnIDs []string) {
	if n == nil {
		return
	}
	n.Columns = cloneStringSlice(columnIDs)
	n.ColumnsLoaded = true
	n.ColumnsTruncated = false
}

func (n *ViewNode) SetConstraints(constraintIDs []string) {
	if n == nil {
		return
	}
	n.Constraints = cloneStringSlice(constraintIDs)
	n.ConstraintsLoaded = true
	n.ConstraintsTruncated = false
}

func (n *ViewNode) SetIndexes(indexIDs []string) {
	if n == nil {
		return
	}
	n.Indexes = cloneStringSlice(indexIDs)
	n.IndexesLoaded = true
	n.IndexesTruncated = false
}

func (n *ViewNode) SetTriggers(triggerIDs []string) {
	if n == nil {
		return
	}
	n.Triggers = cloneStringSlice(triggerIDs)
	n.TriggersLoaded = true
	n.TriggersTruncated = false
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
	if node.ColumnsLoaded {
		out[NodeRelationColumns] = relationToDTO(node.Columns, node.ColumnsTruncated)
	}
	if node.ConstraintsLoaded {
		out[NodeRelationConstraints] = relationToDTO(node.Constraints, node.ConstraintsTruncated)
	}
	if node.IndexesLoaded {
		out[NodeRelationIndexes] = relationToDTO(node.Indexes, node.IndexesTruncated)
	}
	if node.TriggersLoaded {
		out[NodeRelationTriggers] = relationToDTO(node.Triggers, node.TriggersTruncated)
	}
	if len(out) == 0 {
		return emptyRelationsToDTO()
	}
	return out
}
