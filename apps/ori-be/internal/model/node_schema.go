package model

import (
	"fmt"

	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/cloneutil"
	dto "github.com/crueladdict/ori/libs/contract/go"
)

type SchemaNode struct {
	BaseNode
	Attributes dto.SchemaNodeAttributes
	Tables     []string
	Views      []string
}

func (n *SchemaNode) Clone() Node {
	if n == nil {
		return nil
	}
	clone := *n
	clone.BaseNode = n.cloneBase()
	clone.Attributes = n.Attributes
	clone.Tables = cloneutil.Slice(n.Tables)
	clone.Views = cloneutil.Slice(n.Views)
	return &clone
}

func (node *SchemaNode) ToDTO() (dto.Node, error) {
	if node == nil {
		return dto.Node{}, fmt.Errorf("schema node is nil")
	}
	out := dto.Node{}
	err := out.FromSchemaNode(dto.SchemaNode{
		Id:         node.GetID(),
		Name:       node.GetName(),
		Edges:      schemaRelationsToDTO(node),
		Attributes: node.Attributes,
	})
	if err != nil {
		return dto.Node{}, fmt.Errorf("node %s: %w", node.GetID(), err)
	}
	return out, nil
}

func schemaRelationsToDTO(node *SchemaNode) map[string]dto.NodeEdge {
	if node == nil {
		return map[string]dto.NodeEdge{}
	}
	out := map[string]dto.NodeEdge{}
	out[NodeRelationTables] = relationToDTO(node.Tables)
	out[NodeRelationViews] = relationToDTO(node.Views)
	return out
}
