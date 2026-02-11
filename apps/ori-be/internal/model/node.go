package model

import (
	"fmt"

	dto "github.com/crueladdict/ori/libs/contract/go"
)

// Node is the common graph node interface used by services and storage.
type Node interface {
	GetID() string
	GetName() string
	IsHydrated() bool
	SetHydrated(value bool)
	Clone() Node
	ToDTO() (dto.Node, error)
}

const (
	NodeRelationTables      = "tables"
	NodeRelationViews       = "views"
	NodeRelationPartitions  = "partitions"
	NodeRelationColumns     = "columns"
	NodeRelationConstraints = "constraints"
	NodeRelationIndexes     = "indexes"
	NodeRelationTriggers    = "triggers"
)

// Nodes is a typed list of graph nodes.
type Nodes []Node

func ConvertNodesToDTO(nodes []Node) ([]dto.Node, error) {
	return Nodes(nodes).ToDTO()
}

func (nodes Nodes) ToDTO() ([]dto.Node, error) {
	result := make([]dto.Node, len(nodes))
	for i, node := range nodes {
		if node == nil {
			return nil, fmt.Errorf("node at index %d is nil", i)
		}
		mapped, err := node.ToDTO()
		if err != nil {
			return nil, err
		}
		result[i] = mapped
	}
	return result, nil
}

type BaseNode struct {
	ID       string
	Name     string
	Scope    Scope
	Hydrated bool
}

func (n *BaseNode) GetID() string {
	if n == nil {
		return ""
	}
	return n.ID
}

func (n *BaseNode) GetName() string {
	if n == nil {
		return ""
	}
	return n.Name
}

func (n *BaseNode) IsHydrated() bool {
	if n == nil {
		return false
	}
	return n.Hydrated
}

func (n *BaseNode) SetHydrated(value bool) {
	if n == nil {
		return
	}
	n.Hydrated = value
}

func (n *BaseNode) cloneBase() BaseNode {
	if n == nil {
		return BaseNode{}
	}
	return BaseNode{
		ID:       n.ID,
		Name:     n.Name,
		Scope:    n.Scope,
		Hydrated: n.Hydrated,
	}
}

func relationToDTO(ids []string) dto.NodeEdge {
	if ids == nil {
		ids = []string{}
	}
	return dto.NodeEdge{Items: ids, Truncated: false}
}

func stringPtrIfNotEmpty(value string) *string {
	if value == "" {
		return nil
	}
	v := value
	return &v
}
