package model

import (
	"fmt"

	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/cloneutil"
	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/stringutil"
	dto "github.com/crueladdict/ori/libs/contract/go"
)

type IndexNode struct {
	BaseNode
	Columns        *[]string
	Connection     string
	Definition     *string
	IncludeColumns *[]string
	IndexName      string
	Method         *string
	Predicate      *string
	Primary        bool
	Table          string
	Unique         bool
}

func NewIndexNode(engine, connectionName string, scope ScopeID, relation string, idx Index) *IndexNode {
	id := stringutil.Slug(engine, connectionName, "index", scope.Database, relation, idx.Name)
	if scope.Schema != nil {
		id = stringutil.Slug(engine, connectionName, "index", *scope.Schema, relation, idx.Name)
	}

	return &IndexNode{
		BaseNode: BaseNode{
			ID:       id,
			Name:     idx.Name,
			Scope:    scope,
			Hydrated: true,
		},
		Connection:     connectionName,
		Table:          relation,
		IndexName:      idx.Name,
		Unique:         idx.Unique,
		Primary:        idx.Primary,
		Columns:        cloneutil.SlicePtrIfNotEmpty(idx.Columns),
		IncludeColumns: cloneutil.SlicePtrIfNotEmpty(idx.IncludeColumns),
		Definition:     stringPtrIfNotEmpty(idx.Definition),
		Method:         stringPtrIfNotEmpty(idx.Method),
		Predicate:      stringPtrIfNotEmpty(idx.Predicate),
	}
}

func (n *IndexNode) Clone() Node {
	if n == nil {
		return nil
	}
	clone := *n
	clone.BaseNode = n.cloneBase()
	clone.Columns = cloneutil.SlicePtr(n.Columns)
	clone.Definition = cloneutil.Ptr(n.Definition)
	clone.IncludeColumns = cloneutil.SlicePtr(n.IncludeColumns)
	clone.Method = cloneutil.Ptr(n.Method)
	clone.Predicate = cloneutil.Ptr(n.Predicate)
	return &clone
}

func (node *IndexNode) ToDTO() (dto.Node, error) {
	if node == nil {
		return dto.Node{}, fmt.Errorf("index node is nil")
	}
	out := dto.Node{}
	err := out.FromIndexNode(dto.IndexNode{
		Id:    node.GetID(),
		Name:  node.GetName(),
		Edges: map[string]dto.NodeEdge{},
		Attributes: dto.IndexNodeAttributes{
			Columns:        node.Columns,
			Connection:     node.Connection,
			Definition:     node.Definition,
			IncludeColumns: node.IncludeColumns,
			IndexName:      node.IndexName,
			Method:         node.Method,
			Predicate:      node.Predicate,
			Primary:        node.Primary,
			Table:          node.Table,
			Unique:         node.Unique,
		},
	})
	if err != nil {
		return dto.Node{}, fmt.Errorf("node %s: %w", node.GetID(), err)
	}
	return out, nil
}
