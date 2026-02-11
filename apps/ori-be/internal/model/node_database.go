package model

import (
	"fmt"

	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/cloneutil"
	dto "github.com/crueladdict/ori/libs/contract/go"
)

type DatabaseNode struct {
	BaseNode
	Attributes dto.DatabaseNodeAttributes
	Tables     []string
	Views      []string
}

func (n *DatabaseNode) Clone() Node {
	if n == nil {
		return nil
	}
	clone := *n
	clone.BaseNode = n.cloneBase()
	clone.Attributes = dto.DatabaseNodeAttributes{
		Connection: n.Attributes.Connection,
		Encoding:   cloneutil.Ptr(n.Attributes.Encoding),
		Engine:     n.Attributes.Engine,
		File:       cloneutil.Ptr(n.Attributes.File),
		PageSize:   cloneutil.Ptr(n.Attributes.PageSize),
		Sequence:   cloneutil.Ptr(n.Attributes.Sequence),
	}
	clone.Tables = cloneutil.Slice(n.Tables)
	clone.Views = cloneutil.Slice(n.Views)
	return &clone
}

func (node *DatabaseNode) ToDTO() (dto.Node, error) {
	if node == nil {
		return dto.Node{}, fmt.Errorf("database node is nil")
	}
	out := dto.Node{}
	err := out.FromDatabaseNode(dto.DatabaseNode{
		Id:   node.GetID(),
		Name: node.GetName(),
		Edges: map[string]dto.NodeEdge{
			NodeRelationTables: relationToDTO(node.Tables),
			NodeRelationViews:  relationToDTO(node.Views),
		},
		Attributes: node.Attributes,
	})
	if err != nil {
		return dto.Node{}, fmt.Errorf("node %s: %w", node.GetID(), err)
	}
	return out, nil
}
