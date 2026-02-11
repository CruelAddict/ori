package model

import (
	"fmt"

	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/cloneutil"
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
	clone.Attributes = dto.TableNodeAttributes{
		Connection: n.Attributes.Connection,
		Definition: cloneutil.Ptr(n.Attributes.Definition),
		Table:      n.Attributes.Table,
		TableType:  n.Attributes.TableType,
	}
	clone.Partitions = cloneutil.Slice(n.Partitions)
	clone.Columns = cloneutil.Slice(n.Columns)
	clone.Constraints = cloneutil.Slice(n.Constraints)
	clone.Indexes = cloneutil.Slice(n.Indexes)
	clone.Triggers = cloneutil.Slice(n.Triggers)
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
		Id:   node.GetID(),
		Name: node.GetName(),
		Edges: map[string]dto.NodeEdge{
			NodeRelationPartitions:  relationToDTO(node.Partitions),
			NodeRelationColumns:     relationToDTO(node.Columns),
			NodeRelationConstraints: relationToDTO(node.Constraints),
			NodeRelationIndexes:     relationToDTO(node.Indexes),
			NodeRelationTriggers:    relationToDTO(node.Triggers),
		},
		Attributes: node.Attributes,
	})
	if err != nil {
		return dto.Node{}, fmt.Errorf("node %s: %w", node.GetID(), err)
	}
	return out, nil
}
