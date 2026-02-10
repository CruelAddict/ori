package model

import (
	"fmt"

	dto "github.com/crueladdict/ori/libs/contract/go"
)

type DatabaseNode struct {
	BaseNode
	Attributes dto.DatabaseNodeAttributes
	Tables     []string
	Views      []string
}

func (n *DatabaseNode) Clone() Node {
	if n == nil {
		return nil
	}
	clone := *n
	clone.BaseNode = n.cloneBase()
	clone.Attributes = cloneDatabaseAttributes(n.Attributes)
	clone.Tables = cloneRelationIDs(n.Tables)
	clone.Views = cloneRelationIDs(n.Views)
	return &clone
}

func (node *DatabaseNode) ToDTO() (dto.Node, error) {
	if node == nil {
		return dto.Node{}, fmt.Errorf("database node is nil")
	}
	out := dto.Node{}
	err := out.FromDatabaseNode(dto.DatabaseNode{
		Id:         node.GetID(),
		Name:       node.GetName(),
		Edges:      databaseRelationsToDTO(node),
		Attributes: cloneDatabaseAttributes(node.Attributes),
	})
	if err != nil {
		return dto.Node{}, fmt.Errorf("node %s: %w", node.GetID(), err)
	}
	return out, nil
}

func databaseRelationsToDTO(node *DatabaseNode) map[string]dto.NodeEdge {
	if node == nil {
		return map[string]dto.NodeEdge{}
	}
	out := map[string]dto.NodeEdge{}
	if node.IsHydrated() || len(node.Tables) > 0 {
		out[NodeRelationTables] = relationToDTO(node.Tables)
	}
	if node.IsHydrated() || len(node.Views) > 0 {
		out[NodeRelationViews] = relationToDTO(node.Views)
	}
	return out
}
