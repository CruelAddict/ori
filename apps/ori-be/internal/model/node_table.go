package model

import (
	"fmt"

	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/cloneutil"
	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/stringutil"
	dto "github.com/crueladdict/ori/libs/contract/go"
)

type TableNode struct {
	BaseNode
	Connection  string
	Definition  *string
	Table       string
	TableType   string
	Partitions  []string
	Columns     []string
	Constraints []string
	Indexes     []string
	Triggers    []string
}

func NewRelationNode(scope Scope, rel Relation) Node {
	if rel.Type == "view" {
		return NewViewNode(scope, rel)
	}
	return NewTableNode(scope, rel)
}

func NewTableNode(scope Scope, rel Relation) *TableNode {
	id := stringutil.Slug(scope.Slug(), rel.Name, rel.Type)

	return &TableNode{
		BaseNode: BaseNode{
			ID:       id,
			Name:     rel.Name,
			Scope:    scope,
			Hydrated: false,
		},
		Connection: scope.Connection(),
		Definition: stringPtrIfNotEmpty(rel.Definition),
		Table:      rel.Name,
		TableType:  rel.Type,
	}
}

func (n *TableNode) Clone() Node {
	if n == nil {
		return nil
	}
	clone := *n
	clone.BaseNode = n.cloneBase()
	clone.Definition = cloneutil.Ptr(n.Definition)
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
	return n.Table
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
		Attributes: dto.TableNodeAttributes{
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
