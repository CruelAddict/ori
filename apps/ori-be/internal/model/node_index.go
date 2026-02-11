package model

import (
	"fmt"

	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/cloneutil"
	dto "github.com/crueladdict/ori/libs/contract/go"
)

type IndexNode struct {
	BaseNode
	Attributes dto.IndexNodeAttributes
}

func (n *IndexNode) Clone() Node {
	if n == nil {
		return nil
	}
	clone := *n
	clone.BaseNode = n.cloneBase()
	clone.Attributes = dto.IndexNodeAttributes{
		Columns:        cloneutil.SlicePtr(n.Attributes.Columns),
		Connection:     n.Attributes.Connection,
		Definition:     cloneutil.Ptr(n.Attributes.Definition),
		IncludeColumns: cloneutil.SlicePtr(n.Attributes.IncludeColumns),
		IndexName:      n.Attributes.IndexName,
		Method:         cloneutil.Ptr(n.Attributes.Method),
		Predicate:      cloneutil.Ptr(n.Attributes.Predicate),
		Primary:        n.Attributes.Primary,
		Table:          n.Attributes.Table,
		Unique:         n.Attributes.Unique,
	}
	return &clone
}

func (node *IndexNode) ToDTO() (dto.Node, error) {
	if node == nil {
		return dto.Node{}, fmt.Errorf("index node is nil")
	}
	out := dto.Node{}
	err := out.FromIndexNode(dto.IndexNode{
		Id:         node.GetID(),
		Name:       node.GetName(),
		Edges:      map[string]dto.NodeEdge{},
		Attributes: node.Attributes,
	})
	if err != nil {
		return dto.Node{}, fmt.Errorf("node %s: %w", node.GetID(), err)
	}
	return out, nil
}
