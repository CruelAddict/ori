package model

import (
	"fmt"

	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/cloneutil"
	dto "github.com/crueladdict/ori/libs/contract/go"
)

type ViewNode struct {
	BaseNode
	Attributes  dto.ViewNodeAttributes
	Columns     []string
	Constraints []string
	Indexes     []string
	Triggers    []string
}

func (n *ViewNode) Clone() Node {
	if n == nil {
		return nil
	}
	clone := *n
	clone.BaseNode = n.cloneBase()
	clone.Attributes = cloneViewAttributes(n.Attributes)
	clone.Columns = cloneutil.Slice(n.Columns)
	clone.Constraints = cloneutil.Slice(n.Constraints)
	clone.Indexes = cloneutil.Slice(n.Indexes)
	clone.Triggers = cloneutil.Slice(n.Triggers)
	return &clone
}

func (n *ViewNode) RelationName() string {
	if n == nil {
		return ""
	}
	return n.Attributes.Table
}

func (node *ViewNode) ToDTO() (dto.Node, error) {
	if node == nil {
		return dto.Node{}, fmt.Errorf("view node is nil")
	}
	out := dto.Node{}
	err := out.FromViewNode(dto.ViewNode{
		Id:         node.GetID(),
		Name:       node.GetName(),
		Edges:      viewRelationsToDTO(node),
		Attributes: node.Attributes,
	})
	if err != nil {
		return dto.Node{}, fmt.Errorf("node %s: %w", node.GetID(), err)
	}
	return out, nil
}

func viewRelationsToDTO(node *ViewNode) map[string]dto.NodeEdge {
	if node == nil {
		return map[string]dto.NodeEdge{}
	}
	out := map[string]dto.NodeEdge{}
	out[NodeRelationColumns] = relationToDTO(node.Columns)
	out[NodeRelationConstraints] = relationToDTO(node.Constraints)
	out[NodeRelationIndexes] = relationToDTO(node.Indexes)
	out[NodeRelationTriggers] = relationToDTO(node.Triggers)
	return out
}

func cloneViewAttributes(attrs dto.ViewNodeAttributes) dto.ViewNodeAttributes {
	return dto.ViewNodeAttributes{
		Connection: attrs.Connection,
		Definition: cloneutil.Ptr(attrs.Definition),
		Table:      attrs.Table,
		TableType:  attrs.TableType,
	}
}
