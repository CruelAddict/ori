package model

import (
	"maps"

	dto "github.com/crueladdict/ori/libs/contract/go"
)

// ConvertNodesToDTO converts internal node representations to the public DTOs and
// enforces the edge truncation limit at response time.
func ConvertNodesToDTO(nodes []*Node, edgeLimit int) []dto.Node {
	if len(nodes) == 0 {
		return nil
	}
	result := make([]dto.Node, len(nodes))
	for i, node := range nodes {
		result[i] = convertNode(node, edgeLimit)
	}
	return result
}

func convertNode(node *Node, edgeLimit int) dto.Node {
	if node == nil {
		return dto.Node{}
	}
	out := dto.Node{
		Id:   node.ID,
		Type: node.Type,
		Name: node.Name,
	}
	out.Attributes = cloneAttributes(node.Attributes)
	out.Edges = make(map[string]dto.NodeEdge, len(node.Edges))
	for kind, edge := range node.Edges {
		total := len(edge.Items)
		max := edgeLimit
		if max <= 0 || max > total {
			max = total
		}
		items := make([]string, max)
		copy(items, edge.Items[:max])
		out.Edges[kind] = dto.NodeEdge{Items: items, Truncated: total > max}
	}
	return out
}

func cloneAttributes(attrs map[string]any) map[string]any {
	copyAttrs := make(map[string]any, len(attrs))
	maps.Copy(copyAttrs, attrs)
	return copyAttrs
}
