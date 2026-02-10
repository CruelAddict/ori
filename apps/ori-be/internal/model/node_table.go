package model

import (
	"fmt"

	dto "github.com/crueladdict/ori/libs/contract/go"
)

type TableNode struct {
	BaseNode
	Attributes           dto.TableNodeAttributes
	Partitions           []string
	PartitionsLoaded     bool
	PartitionsTruncated  bool
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

func (n *TableNode) Clone() Node {
	if n == nil {
		return nil
	}
	clone := *n
	clone.BaseNode = n.cloneBase()
	clone.Attributes = cloneTableAttributes(n.Attributes)
	clone.Partitions, clone.PartitionsLoaded, clone.PartitionsTruncated = cloneRelationIDs(n.Partitions, n.PartitionsLoaded, n.PartitionsTruncated)
	clone.Columns, clone.ColumnsLoaded, clone.ColumnsTruncated = cloneRelationIDs(n.Columns, n.ColumnsLoaded, n.ColumnsTruncated)
	clone.Constraints, clone.ConstraintsLoaded, clone.ConstraintsTruncated = cloneRelationIDs(n.Constraints, n.ConstraintsLoaded, n.ConstraintsTruncated)
	clone.Indexes, clone.IndexesLoaded, clone.IndexesTruncated = cloneRelationIDs(n.Indexes, n.IndexesLoaded, n.IndexesTruncated)
	clone.Triggers, clone.TriggersLoaded, clone.TriggersTruncated = cloneRelationIDs(n.Triggers, n.TriggersLoaded, n.TriggersTruncated)
	return &clone
}

func (n *TableNode) SetPartitions(partitionIDs []string) {
	if n == nil {
		return
	}
	n.Partitions = cloneStringSlice(partitionIDs)
	n.PartitionsLoaded = true
	n.PartitionsTruncated = false
}

func (n *TableNode) SetColumns(columnIDs []string) {
	if n == nil {
		return
	}
	n.Columns = cloneStringSlice(columnIDs)
	n.ColumnsLoaded = true
	n.ColumnsTruncated = false
}

func (n *TableNode) SetConstraints(constraintIDs []string) {
	if n == nil {
		return
	}
	n.Constraints = cloneStringSlice(constraintIDs)
	n.ConstraintsLoaded = true
	n.ConstraintsTruncated = false
}

func (n *TableNode) SetIndexes(indexIDs []string) {
	if n == nil {
		return
	}
	n.Indexes = cloneStringSlice(indexIDs)
	n.IndexesLoaded = true
	n.IndexesTruncated = false
}

func (n *TableNode) SetTriggers(triggerIDs []string) {
	if n == nil {
		return
	}
	n.Triggers = cloneStringSlice(triggerIDs)
	n.TriggersLoaded = true
	n.TriggersTruncated = false
}

func (n *TableNode) RelationName() string {
	if n == nil {
		return ""
	}
	return n.Attributes.Table
}

func (node *TableNode) ToDTO() (dto.Node, error) {
	if node == nil {
		return dto.Node{}, fmt.Errorf("table node is nil")
	}
	out := dto.Node{}
	err := out.FromTableNode(dto.TableNode{
		Id:         node.GetID(),
		Name:       node.GetName(),
		Edges:      tableRelationsToDTO(node),
		Attributes: cloneTableAttributes(node.Attributes),
	})
	if err != nil {
		return dto.Node{}, fmt.Errorf("node %s: %w", node.GetID(), err)
	}
	return out, nil
}

func tableRelationsToDTO(node *TableNode) map[string]dto.NodeEdge {
	if node == nil {
		return emptyRelationsToDTO()
	}
	out := make(map[string]dto.NodeEdge, 5)
	if node.PartitionsLoaded {
		out[NodeRelationPartitions] = relationToDTO(node.Partitions, node.PartitionsTruncated)
	}
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
