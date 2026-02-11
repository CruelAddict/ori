package model

import (
	"fmt"

	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/cloneutil"
	dto "github.com/crueladdict/ori/libs/contract/go"
)

type ViewNode struct {
	BaseNode
	Attributes  dto.ViewNodeAttributes
	Columns     []string
	Constraints []string
	Indexes     []string
	Triggers    []string
}

func (n *ViewNode) Clone() Node {
	if n == nil {
		return nil
	}
	clone := *n
	clone.BaseNode = n.cloneBase()
	clone.Attributes = dto.ViewNodeAttributes{
		Connection: n.Attributes.Connection,
		Definition: cloneutil.Ptr(n.Attributes.Definition),
		Table:      n.Attributes.Table,
		TableType:  n.Attributes.TableType,
	}
	clone.Columns = cloneutil.Slice(n.Columns)
	clone.Constraints = cloneutil.Slice(n.Constraints)
	clone.Indexes = cloneutil.Slice(n.Indexes)
	clone.Triggers = cloneutil.Slice(n.Triggers)
	return &clone
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
		Id:   node.GetID(),
		Name: node.GetName(),
		Edges: map[string]dto.NodeEdge{
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
