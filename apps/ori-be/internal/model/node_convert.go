package model

import (
	"maps"

	orisdk "github.com/crueladdict/ori/libs/sdk/go"
)

// NodesToSDK converts internal node representations to the public SDK DTOs and
// enforces the edge truncation limit at response time.
func NodesToSDK(nodes []*Node, edgeLimit int) []orisdk.Node {
	if len(nodes) == 0 {
		return nil
	}
	result := make([]orisdk.Node, len(nodes))
	for i, node := range nodes {
		result[i] = convertNode(node, edgeLimit)
	}
	return result
}

func convertNode(node *Node, edgeLimit int) orisdk.Node {
	if node == nil {
		return orisdk.Node{}
	}
	out := orisdk.Node{
		ID:   node.ID,
		Type: node.Type,
		Name: node.Name,
	}
	out.Attributes = cloneAttributes(node.Attributes)
	out.Edges = make(map[string]orisdk.NodeEdge, len(node.Edges))
	for kind, edge := range node.Edges {
		total := len(edge.Items)
		max := edgeLimit
		if max <= 0 || max > total {
			max = total
		}
		items := make([]string, max)
		copy(items, edge.Items[:max])
		out.Edges[kind] = orisdk.NodeEdge{Items: items, Truncated: total > max}
	}
	return out
}

func cloneAttributes(attrs map[string]any) map[string]any {
	copyAttrs := make(map[string]any, len(attrs))
	maps.Copy(copyAttrs, attrs)
	return copyAttrs
}
