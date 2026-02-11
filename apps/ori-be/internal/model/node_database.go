package model

import (
	"fmt"

	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/cloneutil"
	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/stringutil"
	dto "github.com/crueladdict/ori/libs/contract/go"
)

type DatabaseNode struct {
	BaseNode
	Connection string
	Encoding   *string
	Engine     string
	File       *string
	PageSize   *int64
	Sequence   *int
	Tables     []string
	Views      []string
}

func NewDatabaseNode(engine, connectionName string, scope Database) *DatabaseNode {
	scopeID := scope.ID()
	id := stringutil.Slug(engine, connectionName, "database", scopeID.Database)
	if scopeID.Schema != nil {
		id = stringutil.Slug(engine, connectionName, "schema", *scopeID.Schema)
	}

	return &DatabaseNode{
		BaseNode: BaseNode{
			ID:       id,
			Name:     scope.Name,
			Scope:    scopeID,
			Hydrated: false,
		},
		Connection: connectionName,
		Engine:     engine,
		File:       cloneutil.Ptr(scope.File),
		Sequence:   cloneutil.Ptr(scope.Sequence),
		PageSize:   cloneutil.Ptr(scope.PageSize),
		Encoding:   cloneutil.Ptr(scope.Encoding),
	}
}

func (n *DatabaseNode) Clone() Node {
	if n == nil {
		return nil
	}
	clone := *n
	clone.BaseNode = n.cloneBase()
	clone.Encoding = cloneutil.Ptr(n.Encoding)
	clone.File = cloneutil.Ptr(n.File)
	clone.PageSize = cloneutil.Ptr(n.PageSize)
	clone.Sequence = cloneutil.Ptr(n.Sequence)
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
		Attributes: dto.DatabaseNodeAttributes{
			Connection: node.Connection,
			Encoding:   node.Encoding,
			Engine:     node.Engine,
			File:       node.File,
			PageSize:   node.PageSize,
			Sequence:   node.Sequence,
		},
	})
	if err != nil {
		return dto.Node{}, fmt.Errorf("node %s: %w", node.GetID(), err)
	}
	return out, nil
}
