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
	clone.Attributes = cloneColumnAttributes(n.Attributes)
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

func cloneColumnAttributes(attrs dto.ColumnNodeAttributes) dto.ColumnNodeAttributes {
	return dto.ColumnNodeAttributes{
		CharMaxLength:      cloneutil.Ptr(attrs.CharMaxLength),
		Column:             attrs.Column,
		Connection:         attrs.Connection,
		DataType:           attrs.DataType,
		DefaultValue:       cloneutil.Ptr(attrs.DefaultValue),
		NotNull:            attrs.NotNull,
		NumericPrecision:   cloneutil.Ptr(attrs.NumericPrecision),
		NumericScale:       cloneutil.Ptr(attrs.NumericScale),
		Ordinal:            attrs.Ordinal,
		PrimaryKeyPosition: cloneutil.Ptr(attrs.PrimaryKeyPosition),
		Table:              attrs.Table,
	}
}
