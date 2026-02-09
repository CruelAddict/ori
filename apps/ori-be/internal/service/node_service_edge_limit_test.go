package service

import (
	"testing"

	"github.com/crueladdict/ori/apps/ori-server/internal/model"
)

func TestCloneEdgeMapAppliesLimitAndMarksTruncated(t *testing.T) {
	source := map[string]model.EdgeList{
		"tables": {
			Items: []string{"users", "orders", "events"},
		},
	}

	cloned := cloneEdgeMap(source, 2)
	edge := cloned["tables"]

	if len(edge.Items) != 2 {
		t.Fatalf("expected 2 edge items, got %d", len(edge.Items))
	}
	if !edge.Truncated {
		t.Fatalf("expected truncated edge flag to be true")
	}
	if len(source["tables"].Items) != 3 {
		t.Fatalf("expected source edge items to remain unchanged")
	}
}
