package model

import (
	"fmt"

	dto "github.com/crueladdict/ori/libs/contract/go"
)

type SchemaNode struct {
	BaseNode
	Attributes      dto.SchemaNodeAttributes
	Tables          []string
	TablesLoaded    bool
	TablesTruncated bool
	Views           []string
	ViewsLoaded     bool
	ViewsTruncated  bool
}

func (n *SchemaNode) Clone() Node {
	if n == nil {
		return nil
	}
	clone := *n
	clone.BaseNode = n.cloneBase()
	clone.Attributes = n.Attributes
	clone.Tables, clone.TablesLoaded, clone.TablesTruncated = cloneRelationIDs(n.Tables, n.TablesLoaded, n.TablesTruncated)
	clone.Views, clone.ViewsLoaded, clone.ViewsTruncated = cloneRelationIDs(n.Views, n.ViewsLoaded, n.ViewsTruncated)
	return &clone
}

func (n *SchemaNode) SetTables(tableIDs []string) {
	if n == nil {
		return
	}
	n.Tables = cloneStringSlice(tableIDs)
	n.TablesLoaded = true
	n.TablesTruncated = false
}

func (n *SchemaNode) SetViews(viewIDs []string) {
	if n == nil {
		return
	}
	n.Views = cloneStringSlice(viewIDs)
	n.ViewsLoaded = true
	n.ViewsTruncated = false
}

func (node *SchemaNode) ToDTO() (dto.Node, error) {
	if node == nil {
		return dto.Node{}, fmt.Errorf("schema node is nil")
	}
	out := dto.Node{}
	err := out.FromSchemaNode(dto.SchemaNode{
		Id:         node.GetID(),
		Name:       node.GetName(),
		Edges:      schemaRelationsToDTO(node),
		Attributes: node.Attributes,
	})
	if err != nil {
		return dto.Node{}, fmt.Errorf("node %s: %w", node.GetID(), err)
	}
	return out, nil
}

func schemaRelationsToDTO(node *SchemaNode) map[string]dto.NodeEdge {
	if node == nil {
		return emptyRelationsToDTO()
	}
	out := make(map[string]dto.NodeEdge, 2)
	if node.TablesLoaded {
		out[NodeRelationTables] = relationToDTO(node.Tables, node.TablesTruncated)
	}
	if node.ViewsLoaded {
		out[NodeRelationViews] = relationToDTO(node.Views, node.ViewsTruncated)
	}
	if len(out) == 0 {
		return emptyRelationsToDTO()
	}
	return out
}
