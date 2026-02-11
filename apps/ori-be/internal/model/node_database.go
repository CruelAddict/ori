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
	clone.Attributes = cloneDatabaseAttributes(n.Attributes)
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
		Id:         node.GetID(),
		Name:       node.GetName(),
		Edges:      databaseRelationsToDTO(node),
		Attributes: node.Attributes,
	})
	if err != nil {
		return dto.Node{}, fmt.Errorf("node %s: %w", node.GetID(), err)
	}
	return out, nil
}

func databaseRelationsToDTO(node *DatabaseNode) map[string]dto.NodeEdge {
	if node == nil {
		return map[string]dto.NodeEdge{}
	}
	out := map[string]dto.NodeEdge{}
	out[NodeRelationTables] = relationToDTO(node.Tables)
	out[NodeRelationViews] = relationToDTO(node.Views)
	return out
}

func cloneDatabaseAttributes(attrs dto.DatabaseNodeAttributes) dto.DatabaseNodeAttributes {
	return dto.DatabaseNodeAttributes{
		Connection: attrs.Connection,
		Encoding:   cloneutil.Ptr(attrs.Encoding),
		Engine:     attrs.Engine,
		File:       cloneutil.Ptr(attrs.File),
		PageSize:   cloneutil.Ptr(attrs.PageSize),
		Sequence:   cloneutil.Ptr(attrs.Sequence),
	}
}
