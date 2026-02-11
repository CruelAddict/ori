package model

import (
	"fmt"

	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/cloneutil"
	dto "github.com/crueladdict/ori/libs/contract/go"
)

type ConstraintNode struct {
	BaseNode
	CheckClause        *string
	Columns            *[]string
	Connection         string
	ConstraintName     string
	ConstraintType     string
	IndexName          *string
	Match              *string
	OnDelete           *string
	OnUpdate           *string
	ReferencedColumns  *[]string
	ReferencedDatabase *string
	ReferencedSchema   *string
	ReferencedTable    *string
	Table              string
}

func (n *ConstraintNode) Clone() Node {
	if n == nil {
		return nil
	}
	clone := *n
	clone.BaseNode = n.cloneBase()
	clone.CheckClause = cloneutil.Ptr(n.CheckClause)
	clone.Columns = cloneutil.SlicePtr(n.Columns)
	clone.IndexName = cloneutil.Ptr(n.IndexName)
	clone.Match = cloneutil.Ptr(n.Match)
	clone.OnDelete = cloneutil.Ptr(n.OnDelete)
	clone.OnUpdate = cloneutil.Ptr(n.OnUpdate)
	clone.ReferencedColumns = cloneutil.SlicePtr(n.ReferencedColumns)
	clone.ReferencedDatabase = cloneutil.Ptr(n.ReferencedDatabase)
	clone.ReferencedSchema = cloneutil.Ptr(n.ReferencedSchema)
	clone.ReferencedTable = cloneutil.Ptr(n.ReferencedTable)
	return &clone
}

func (node *ConstraintNode) ToDTO() (dto.Node, error) {
	if node == nil {
		return dto.Node{}, fmt.Errorf("constraint node is nil")
	}
	out := dto.Node{}
	err := out.FromConstraintNode(dto.ConstraintNode{
		Id:    node.GetID(),
		Name:  node.GetName(),
		Edges: map[string]dto.NodeEdge{},
		Attributes: dto.ConstraintNodeAttributes{
			CheckClause:        node.CheckClause,
			Columns:            node.Columns,
			Connection:         node.Connection,
			ConstraintName:     node.ConstraintName,
			ConstraintType:     node.ConstraintType,
			IndexName:          node.IndexName,
			Match:              node.Match,
			OnDelete:           node.OnDelete,
			OnUpdate:           node.OnUpdate,
			ReferencedColumns:  node.ReferencedColumns,
			ReferencedDatabase: node.ReferencedDatabase,
			ReferencedSchema:   node.ReferencedSchema,
			ReferencedTable:    node.ReferencedTable,
			Table:              node.Table,
		},
	})
	if err != nil {
		return dto.Node{}, fmt.Errorf("node %s: %w", node.GetID(), err)
	}
	return out, nil
}
