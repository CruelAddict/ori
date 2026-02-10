package model

import (
	"fmt"

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
	clone.Tables = cloneRelationIDs(n.Tables)
	clone.Views = cloneRelationIDs(n.Views)
	return &clone
}

func (n *SchemaNode) SetTables(tableIDs []string) {
	if n == nil {
		return
	}
	n.Tables = cloneStringSlice(tableIDs)
}

func (n *SchemaNode) SetViews(viewIDs []string) {
	if n == nil {
		return
	}
	n.Views = cloneStringSlice(viewIDs)
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
		return emptyRelationsToDTO()
	}
	out := make(map[string]dto.NodeEdge, 2)
	if node.IsHydrated() || len(node.Tables) > 0 {
		out[NodeRelationTables] = relationToDTO(node.Tables)
	}
	if node.IsHydrated() || len(node.Views) > 0 {
		out[NodeRelationViews] = relationToDTO(node.Views)
	}
	if len(out) == 0 {
		return emptyRelationsToDTO()
	}
	return out
}
