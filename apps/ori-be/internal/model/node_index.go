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
	clone.Attributes = cloneIndexAttributes(n.Attributes)
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

func cloneIndexAttributes(attrs dto.IndexNodeAttributes) dto.IndexNodeAttributes {
	return dto.IndexNodeAttributes{
		Columns:        cloneutil.SlicePtr(attrs.Columns),
		Connection:     attrs.Connection,
		Definition:     cloneutil.Ptr(attrs.Definition),
		IncludeColumns: cloneutil.SlicePtr(attrs.IncludeColumns),
		IndexName:      attrs.IndexName,
		Method:         cloneutil.Ptr(attrs.Method),
		Predicate:      cloneutil.Ptr(attrs.Predicate),
		Primary:        attrs.Primary,
		Table:          attrs.Table,
		Unique:         attrs.Unique,
	}
}
