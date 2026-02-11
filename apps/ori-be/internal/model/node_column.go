package model

import (
	"fmt"

	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/cloneutil"
	dto "github.com/crueladdict/ori/libs/contract/go"
)

type ColumnNode struct {
	BaseNode
	Attributes dto.ColumnNodeAttributes
}

func (n *ColumnNode) Clone() Node {
	if n == nil {
		return nil
	}
	clone := *n
	clone.BaseNode = n.cloneBase()
	clone.Attributes = dto.ColumnNodeAttributes{
		CharMaxLength:      cloneutil.Ptr(n.Attributes.CharMaxLength),
		Column:             n.Attributes.Column,
		Connection:         n.Attributes.Connection,
		DataType:           n.Attributes.DataType,
		DefaultValue:       cloneutil.Ptr(n.Attributes.DefaultValue),
		NotNull:            n.Attributes.NotNull,
		NumericPrecision:   cloneutil.Ptr(n.Attributes.NumericPrecision),
		NumericScale:       cloneutil.Ptr(n.Attributes.NumericScale),
		Ordinal:            n.Attributes.Ordinal,
		PrimaryKeyPosition: cloneutil.Ptr(n.Attributes.PrimaryKeyPosition),
		Table:              n.Attributes.Table,
	}
	return &clone
}

func (node *ColumnNode) ToDTO() (dto.Node, error) {
	if node == nil {
		return dto.Node{}, fmt.Errorf("column node is nil")
	}
	out := dto.Node{}
	err := out.FromColumnNode(dto.ColumnNode{
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
