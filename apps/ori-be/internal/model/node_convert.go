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
		Edges:      databaseRelationsToDTO(node),
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
		Edges:      schemaRelationsToDTO(node),
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
		Edges:      tableRelationsToDTO(node),
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
		Edges:      viewRelationsToDTO(node),
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
		Edges:      emptyRelationsToDTO(),
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
		Edges:      emptyRelationsToDTO(),
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
		Edges:      emptyRelationsToDTO(),
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
		Edges:      emptyRelationsToDTO(),
		Attributes: cloneTriggerAttributes(node.Attributes),
	})
	if err != nil {
		return dto.Node{}, fmt.Errorf("node %s: %w", node.GetID(), err)
	}
	return out, nil
}

func emptyRelationsToDTO() map[string]dto.NodeEdge {
	return map[string]dto.NodeEdge{}
}

func databaseRelationsToDTO(node *DatabaseNode) map[string]dto.NodeEdge {
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

func tableRelationsToDTO(node *TableNode) map[string]dto.NodeEdge {
	if node == nil {
		return emptyRelationsToDTO()
	}
	out := make(map[string]dto.NodeEdge, 5)
	if node.PartitionsLoaded {
		out[NodeRelationPartitions] = relationToDTO(node.Partitions, node.PartitionsTruncated)
	}
	if node.ColumnsLoaded {
		out[NodeRelationColumns] = relationToDTO(node.Columns, node.ColumnsTruncated)
	}
	if node.ConstraintsLoaded {
		out[NodeRelationConstraints] = relationToDTO(node.Constraints, node.ConstraintsTruncated)
	}
	if node.IndexesLoaded {
		out[NodeRelationIndexes] = relationToDTO(node.Indexes, node.IndexesTruncated)
	}
	if node.TriggersLoaded {
		out[NodeRelationTriggers] = relationToDTO(node.Triggers, node.TriggersTruncated)
	}
	if len(out) == 0 {
		return emptyRelationsToDTO()
	}
	return out
}

func viewRelationsToDTO(node *ViewNode) map[string]dto.NodeEdge {
	if node == nil {
		return emptyRelationsToDTO()
	}
	out := make(map[string]dto.NodeEdge, 4)
	if node.ColumnsLoaded {
		out[NodeRelationColumns] = relationToDTO(node.Columns, node.ColumnsTruncated)
	}
	if node.ConstraintsLoaded {
		out[NodeRelationConstraints] = relationToDTO(node.Constraints, node.ConstraintsTruncated)
	}
	if node.IndexesLoaded {
		out[NodeRelationIndexes] = relationToDTO(node.Indexes, node.IndexesTruncated)
	}
	if node.TriggersLoaded {
		out[NodeRelationTriggers] = relationToDTO(node.Triggers, node.TriggersTruncated)
	}
	if len(out) == 0 {
		return emptyRelationsToDTO()
	}
	return out
}

func relationToDTO(ids []string, truncated bool) dto.NodeEdge {
	items := make([]string, len(ids))
	copy(items, ids)
	return dto.NodeEdge{Items: items, Truncated: truncated}
}
