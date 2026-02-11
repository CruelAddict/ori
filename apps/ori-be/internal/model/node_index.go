package model

import (
	"fmt"

	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/cloneutil"
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
