package model

import (
	"fmt"

	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/cloneutil"
	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/stringutil"
	dto "github.com/crueladdict/ori/libs/contract/go"
)

type ViewNode struct {
	BaseNode
	Connection  string
	Definition  *string
	Table       string
	TableType   string
	Columns     []string
	Constraints []string
	Indexes     []string
	Triggers    []string
}

func NewViewNode(engine, connectionName string, scope ScopeID, rel Relation) *ViewNode {
	id := stringutil.Slug(engine, connectionName, rel.Type, scope.Database, rel.Name)
	if scope.Schema != nil {
		id = stringutil.Slug(engine, connectionName, rel.Type, *scope.Schema, rel.Name)
	}

	return &ViewNode{
		BaseNode: BaseNode{
			ID:       id,
			Name:     rel.Name,
			Scope:    scope,
			Hydrated: false,
		},
		Connection: connectionName,
		Definition: stringPtrIfNotEmpty(rel.Definition),
		Table:      rel.Name,
		TableType:  rel.Type,
	}
}

func (n *ViewNode) Clone() Node {
	if n == nil {
		return nil
	}
	clone := *n
	clone.BaseNode = n.cloneBase()
	clone.Definition = cloneutil.Ptr(n.Definition)
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
	return n.Table
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
		Attributes: dto.ViewNodeAttributes{
			Connection: node.Connection,
			Definition: node.Definition,
			Table:      node.Table,
			TableType:  node.TableType,
		},
	})
	if err != nil {
		return dto.Node{}, fmt.Errorf("node %s: %w", node.GetID(), err)
	}
	return out, nil
}
