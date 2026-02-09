package model

import (
	"fmt"

	dto "github.com/crueladdict/ori/libs/contract/go"
)

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

func (node *DatabaseNode) ToDTO() (dto.Node, error) {
	if node == nil {
		return dto.Node{}, fmt.Errorf("database node is nil")
	}
	out := dto.Node{}
	err := out.FromDatabaseNode(dto.DatabaseNode{
		Id:         node.GetID(),
		Name:       node.GetName(),
		Edges:      cloneEdgesToDTO(node.GetEdges()),
		Attributes: cloneDatabaseAttributes(node.Attributes),
	})
	if err != nil {
		return dto.Node{}, fmt.Errorf("node %s: %w", node.GetID(), err)
	}
	return out, nil
}

func (node *SchemaNode) ToDTO() (dto.Node, error) {
	if node == nil {
		return dto.Node{}, fmt.Errorf("schema node is nil")
	}
	out := dto.Node{}
	err := out.FromSchemaNode(dto.SchemaNode{
		Id:         node.GetID(),
		Name:       node.GetName(),
		Edges:      cloneEdgesToDTO(node.GetEdges()),
		Attributes: node.Attributes,
	})
	if err != nil {
		return dto.Node{}, fmt.Errorf("node %s: %w", node.GetID(), err)
	}
	return out, nil
}

func (node *TableNode) ToDTO() (dto.Node, error) {
	if node == nil {
		return dto.Node{}, fmt.Errorf("table node is nil")
	}
	out := dto.Node{}
	err := out.FromTableNode(dto.TableNode{
		Id:         node.GetID(),
		Name:       node.GetName(),
		Edges:      cloneEdgesToDTO(node.GetEdges()),
		Attributes: cloneTableAttributes(node.Attributes),
	})
	if err != nil {
		return dto.Node{}, fmt.Errorf("node %s: %w", node.GetID(), err)
	}
	return out, nil
}

func (node *ViewNode) ToDTO() (dto.Node, error) {
	if node == nil {
		return dto.Node{}, fmt.Errorf("view node is nil")
	}
	out := dto.Node{}
	err := out.FromViewNode(dto.ViewNode{
		Id:         node.GetID(),
		Name:       node.GetName(),
		Edges:      cloneEdgesToDTO(node.GetEdges()),
		Attributes: cloneViewAttributes(node.Attributes),
	})
	if err != nil {
		return dto.Node{}, fmt.Errorf("node %s: %w", node.GetID(), err)
	}
	return out, nil
}

func (node *ColumnNode) ToDTO() (dto.Node, error) {
	if node == nil {
		return dto.Node{}, fmt.Errorf("column node is nil")
	}
	out := dto.Node{}
	err := out.FromColumnNode(dto.ColumnNode{
		Id:         node.GetID(),
		Name:       node.GetName(),
		Edges:      cloneEdgesToDTO(node.GetEdges()),
		Attributes: cloneColumnAttributes(node.Attributes),
	})
	if err != nil {
		return dto.Node{}, fmt.Errorf("node %s: %w", node.GetID(), err)
	}
	return out, nil
}

func (node *ConstraintNode) ToDTO() (dto.Node, error) {
	if node == nil {
		return dto.Node{}, fmt.Errorf("constraint node is nil")
	}
	out := dto.Node{}
	err := out.FromConstraintNode(dto.ConstraintNode{
		Id:         node.GetID(),
		Name:       node.GetName(),
		Edges:      cloneEdgesToDTO(node.GetEdges()),
		Attributes: cloneConstraintAttributes(node.Attributes),
	})
	if err != nil {
		return dto.Node{}, fmt.Errorf("node %s: %w", node.GetID(), err)
	}
	return out, nil
}

func (node *IndexNode) ToDTO() (dto.Node, error) {
	if node == nil {
		return dto.Node{}, fmt.Errorf("index node is nil")
	}
	out := dto.Node{}
	err := out.FromIndexNode(dto.IndexNode{
		Id:         node.GetID(),
		Name:       node.GetName(),
		Edges:      cloneEdgesToDTO(node.GetEdges()),
		Attributes: cloneIndexAttributes(node.Attributes),
	})
	if err != nil {
		return dto.Node{}, fmt.Errorf("node %s: %w", node.GetID(), err)
	}
	return out, nil
}

func (node *TriggerNode) ToDTO() (dto.Node, error) {
	if node == nil {
		return dto.Node{}, fmt.Errorf("trigger node is nil")
	}
	out := dto.Node{}
	err := out.FromTriggerNode(dto.TriggerNode{
		Id:         node.GetID(),
		Name:       node.GetName(),
		Edges:      cloneEdgesToDTO(node.GetEdges()),
		Attributes: cloneTriggerAttributes(node.Attributes),
	})
	if err != nil {
		return dto.Node{}, fmt.Errorf("node %s: %w", node.GetID(), err)
	}
	return out, nil
}

func cloneEdgesToDTO(edges map[string]EdgeList) map[string]dto.NodeEdge {
	if len(edges) == 0 {
		return map[string]dto.NodeEdge{}
	}
	out := make(map[string]dto.NodeEdge, len(edges))
	for kind, edge := range edges {
		items := make([]string, len(edge.Items))
		copy(items, edge.Items)
		out[kind] = dto.NodeEdge{Items: items, Truncated: edge.Truncated}
	}
	return out
}
