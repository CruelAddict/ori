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
	clone.Attributes = dto.ConstraintNodeAttributes{
		CheckClause:        cloneutil.Ptr(n.Attributes.CheckClause),
		Columns:            cloneutil.SlicePtr(n.Attributes.Columns),
		Connection:         n.Attributes.Connection,
		ConstraintName:     n.Attributes.ConstraintName,
		ConstraintType:     n.Attributes.ConstraintType,
		IndexName:          cloneutil.Ptr(n.Attributes.IndexName),
		Match:              cloneutil.Ptr(n.Attributes.Match),
		OnDelete:           cloneutil.Ptr(n.Attributes.OnDelete),
		OnUpdate:           cloneutil.Ptr(n.Attributes.OnUpdate),
		ReferencedColumns:  cloneutil.SlicePtr(n.Attributes.ReferencedColumns),
		ReferencedDatabase: cloneutil.Ptr(n.Attributes.ReferencedDatabase),
		ReferencedSchema:   cloneutil.Ptr(n.Attributes.ReferencedSchema),
		ReferencedTable:    cloneutil.Ptr(n.Attributes.ReferencedTable),
		Table:              n.Attributes.Table,
	}
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
