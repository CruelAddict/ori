package model

import (
	"fmt"

	dto "github.com/crueladdict/ori/libs/contract/go"

	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/cloneutil"
	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/stringutil"
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

func NewConstraintNode(scope Scope, relation string, c Constraint) *ConstraintNode {
	columns := cloneutil.SlicePtrIfNotEmpty(c.Columns)
	referencedTable := stringPtrIfNotEmpty(c.ReferencedTable)
	var referencedDatabase *string
	var referencedSchema *string
	var referencedColumns *[]string
	onUpdate := stringPtrIfNotEmpty(c.OnUpdate)
	onDelete := stringPtrIfNotEmpty(c.OnDelete)
	match := stringPtrIfNotEmpty(c.Match)

	if c.Type == "FOREIGN KEY" {
		if c.ReferencedScope != nil {
			referencedDatabase = stringPtrIfNotEmpty(c.ReferencedScope.DatabaseName())
			if schema := c.ReferencedScope.SchemaName(); schema != nil {
				referencedSchema = cloneutil.Ptr(schema)
			}
		}
		referencedColumns = cloneutil.SlicePtrIfNotEmpty(c.ReferencedColumns)
	}

	indexName := cloneutil.Ptr(c.UnderlyingIndex)
	checkClause := stringPtrIfNotEmpty(c.CheckClause)

	return &ConstraintNode{
		BaseNode: BaseNode{
			ID:       stringutil.Slug(scope.Slug(), relation, c.Name, "constraint"),
			Name:     c.Name,
			Scope:    scope.Clone(),
			Hydrated: true,
		},
		Connection:         scope.Connection(),
		Table:              relation,
		ConstraintName:     c.Name,
		ConstraintType:     c.Type,
		Columns:            columns,
		ReferencedTable:    referencedTable,
		ReferencedDatabase: referencedDatabase,
		ReferencedSchema:   referencedSchema,
		ReferencedColumns:  referencedColumns,
		OnUpdate:           onUpdate,
		OnDelete:           onDelete,
		Match:              match,
		IndexName:          indexName,
		CheckClause:        checkClause,
	}
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
