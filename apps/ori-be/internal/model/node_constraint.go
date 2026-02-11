package model

import (
	"fmt"

	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/cloneutil"
	dto "github.com/crueladdict/ori/libs/contract/go"
)

type ConstraintNode struct {
	BaseNode
	Attributes dto.ConstraintNodeAttributes
}

func (n *ConstraintNode) Clone() Node {
	if n == nil {
		return nil
	}
	clone := *n
	clone.BaseNode = n.cloneBase()
	clone.Attributes = cloneConstraintAttributes(n.Attributes)
	return &clone
}

func (node *ConstraintNode) ToDTO() (dto.Node, error) {
	if node == nil {
		return dto.Node{}, fmt.Errorf("constraint node is nil")
	}
	out := dto.Node{}
	err := out.FromConstraintNode(dto.ConstraintNode{
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

func cloneConstraintAttributes(attrs dto.ConstraintNodeAttributes) dto.ConstraintNodeAttributes {
	return dto.ConstraintNodeAttributes{
		CheckClause:        cloneutil.Ptr(attrs.CheckClause),
		Columns:            cloneutil.SlicePtr(attrs.Columns),
		Connection:         attrs.Connection,
		ConstraintName:     attrs.ConstraintName,
		ConstraintType:     attrs.ConstraintType,
		IndexName:          cloneutil.Ptr(attrs.IndexName),
		Match:              cloneutil.Ptr(attrs.Match),
		OnDelete:           cloneutil.Ptr(attrs.OnDelete),
		OnUpdate:           cloneutil.Ptr(attrs.OnUpdate),
		ReferencedColumns:  cloneutil.SlicePtr(attrs.ReferencedColumns),
		ReferencedDatabase: cloneutil.Ptr(attrs.ReferencedDatabase),
		ReferencedSchema:   cloneutil.Ptr(attrs.ReferencedSchema),
		ReferencedTable:    cloneutil.Ptr(attrs.ReferencedTable),
		Table:              attrs.Table,
	}
}
