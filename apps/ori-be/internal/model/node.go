package model

// EdgeList captures outgoing relationships for a node grouped by an edge kind.
type EdgeList struct {
	Items []string
}

// Node represents a graph element returned by getNodes.
type Node struct {
	ID         string              `json:"id"`
	Type       string              `json:"type"`
	Name       string              `json:"name"`
	Scope      ScopeID             `json:"-"`
	Attributes map[string]any      `json:"attributes"`
	Edges      map[string]EdgeList `json:"edges"`
	Hydrated   bool                `json:"-"`
}
