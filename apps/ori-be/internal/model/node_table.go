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
		return map[string]dto.NodeEdge{}
	}
	out := map[string]dto.NodeEdge{}
	out[NodeRelationPartitions] = relationToDTO(node.Partitions)
	out[NodeRelationColumns] = relationToDTO(node.Columns)
	out[NodeRelationConstraints] = relationToDTO(node.Constraints)
	out[NodeRelationIndexes] = relationToDTO(node.Indexes)
	out[NodeRelationTriggers] = relationToDTO(node.Triggers)
	return out
}
