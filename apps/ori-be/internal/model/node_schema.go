package model

import (
	"fmt"

	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/cloneutil"
	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/stringutil"
	dto "github.com/crueladdict/ori/libs/contract/go"
)

type SchemaNode struct {
	BaseNode
	Connection string
	Engine     string
	Tables     []string
	Views      []string
}

func NewSchemaNode(engine, connectionName string, scope Schema) *SchemaNode {
	scopeID := scope.ID()
	id := stringutil.Slug(engine, connectionName, "database", scopeID.Database)
	if scopeID.Schema != nil {
		id = stringutil.Slug(engine, connectionName, "schema", *scopeID.Schema)
	}

	return &SchemaNode{
		BaseNode: BaseNode{
			ID:       id,
			Name:     scope.Name,
			Scope:    scopeID,
			Hydrated: false,
		},
		Connection: connectionName,
		Engine:     engine,
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
