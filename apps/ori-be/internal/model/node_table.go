package model

import (
	"fmt"

	dto "github.com/crueladdict/ori/libs/contract/go"
)

type TableNode struct {
	BaseNode
	Attributes  dto.TableNodeAttributes
	Partitions  []string
	Columns     []string
	Constraints []string
	Indexes     []string
	Triggers    []string
}

func (n *TableNode) Clone() Node {
	if n == nil {
		return nil
	}
	clone := *n
	clone.BaseNode = n.cloneBase()
	clone.Attributes = cloneTableAttributes(n.Attributes)
	clone.Partitions = cloneRelationIDs(n.Partitions)
	clone.Columns = cloneRelationIDs(n.Columns)
	clone.Constraints = cloneRelationIDs(n.Constraints)
	clone.Indexes = cloneRelationIDs(n.Indexes)
	clone.Triggers = cloneRelationIDs(n.Triggers)
	return &clone
}

func (n *TableNode) SetPartitions(partitionIDs []string) {
	if n == nil {
		return
	}
	n.Partitions = cloneStringSlice(partitionIDs)
}

func (n *TableNode) SetColumns(columnIDs []string) {
	if n == nil {
		return
	}
	n.Columns = cloneStringSlice(columnIDs)
}

func (n *TableNode) SetConstraints(constraintIDs []string) {
	if n == nil {
		return
	}
	n.Constraints = cloneStringSlice(constraintIDs)
}

func (n *TableNode) SetIndexes(indexIDs []string) {
	if n == nil {
		return
	}
	n.Indexes = cloneStringSlice(indexIDs)
}

func (n *TableNode) SetTriggers(triggerIDs []string) {
	if n == nil {
		return
	}
	n.Triggers = cloneStringSlice(triggerIDs)
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
	if len(node.Partitions) > 0 {
		out[NodeRelationPartitions] = relationToDTO(node.Partitions)
	}
	if node.IsHydrated() || len(node.Columns) > 0 {
		out[NodeRelationColumns] = relationToDTO(node.Columns)
	}
	if node.IsHydrated() || len(node.Constraints) > 0 {
		out[NodeRelationConstraints] = relationToDTO(node.Constraints)
	}
	if node.IsHydrated() || len(node.Indexes) > 0 {
		out[NodeRelationIndexes] = relationToDTO(node.Indexes)
	}
	if node.IsHydrated() || len(node.Triggers) > 0 {
		out[NodeRelationTriggers] = relationToDTO(node.Triggers)
	}
	if len(out) == 0 {
		return emptyRelationsToDTO()
	}
	return out
}
