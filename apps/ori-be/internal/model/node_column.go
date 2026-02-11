package model

import (
	"fmt"

	dto "github.com/crueladdict/ori/libs/contract/go"

	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/cloneutil"
	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/stringutil"
)

type ColumnNode struct {
	BaseNode
	CharMaxLength      *int64
	Column             string
	Connection         string
	DataType           string
	DefaultValue       *string
	NotNull            bool
	NumericPrecision   *int64
	NumericScale       *int64
	Ordinal            int
	PrimaryKeyPosition *int
	Table              string
}

func NewColumnNode(scope Scope, relation string, col Column) *ColumnNode {
	var primaryKeyPosition *int
	if col.PrimaryKeyPos > 0 {
		v := col.PrimaryKeyPos
		primaryKeyPosition = &v
	}

	return &ColumnNode{
		BaseNode: BaseNode{
			ID:       stringutil.Slug(scope.Slug(), relation, col.Name, "column"),
			Name:     col.Name,
			Scope:    scope,
			Hydrated: true,
		},
		Connection:         scope.Connection(),
		Table:              relation,
		Column:             col.Name,
		Ordinal:            col.Ordinal,
		DataType:           col.DataType,
		NotNull:            col.NotNull,
		DefaultValue:       col.DefaultValue,
		PrimaryKeyPosition: primaryKeyPosition,
		CharMaxLength:      col.CharMaxLength,
		NumericPrecision:   col.NumericPrecision,
		NumericScale:       col.NumericScale,
	}
}

func (n *ColumnNode) Clone() Node {
	if n == nil {
		return nil
	}
	clone := *n
	clone.BaseNode = n.cloneBase()
	clone.CharMaxLength = cloneutil.Ptr(n.CharMaxLength)
	clone.DefaultValue = cloneutil.Ptr(n.DefaultValue)
	clone.NumericPrecision = cloneutil.Ptr(n.NumericPrecision)
	clone.NumericScale = cloneutil.Ptr(n.NumericScale)
	clone.PrimaryKeyPosition = cloneutil.Ptr(n.PrimaryKeyPosition)
	return &clone
}

func (node *ColumnNode) ToDTO() (dto.Node, error) {
	if node == nil {
		return dto.Node{}, fmt.Errorf("column node is nil")
	}
	out := dto.Node{}
	err := out.FromColumnNode(dto.ColumnNode{
		Id:    node.GetID(),
		Name:  node.GetName(),
		Edges: map[string]dto.NodeEdge{},
		Attributes: dto.ColumnNodeAttributes{
			CharMaxLength:      node.CharMaxLength,
			Column:             node.Column,
			Connection:         node.Connection,
			DataType:           node.DataType,
			DefaultValue:       node.DefaultValue,
			NotNull:            node.NotNull,
			NumericPrecision:   node.NumericPrecision,
			NumericScale:       node.NumericScale,
			Ordinal:            node.Ordinal,
			PrimaryKeyPosition: node.PrimaryKeyPosition,
			Table:              node.Table,
		},
	})
	if err != nil {
		return dto.Node{}, fmt.Errorf("node %s: %w", node.GetID(), err)
	}
	return out, nil
}
