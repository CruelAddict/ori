package model

import (
	"fmt"

	dto "github.com/crueladdict/ori/libs/contract/go"

	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/cloneutil"
)

type SchemaNode struct {
	BaseNode
	Connection string
	Engine     string
	Tables     []string
	Views      []string
}

func NewSchemaNode(scope Schema) *SchemaNode {
	return &SchemaNode{
		BaseNode: BaseNode{
			ID:       scope.Slug(),
			Name:     scope.Name,
			Scope:    scope,
			Hydrated: false,
		},
		Connection: scope.ConnectionName,
		Engine:     scope.Engine,
	}
}

func (n *SchemaNode) Clone() Node {
	if n == nil {
		return nil
	}
	clone := *n
	clone.BaseNode = n.cloneBase()
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
		Id:   node.GetID(),
		Name: node.GetName(),
		Edges: map[string]dto.NodeEdge{
			NodeRelationTables: relationToDTO(node.Tables),
			NodeRelationViews:  relationToDTO(node.Views),
		},
		Attributes: dto.SchemaNodeAttributes{
			Connection: node.Connection,
			Engine:     node.Engine,
		},
	})
	if err != nil {
		return dto.Node{}, fmt.Errorf("node %s: %w", node.GetID(), err)
	}
	return out, nil
}
