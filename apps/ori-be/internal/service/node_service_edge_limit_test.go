package service

import (
	"testing"

	"github.com/crueladdict/ori/apps/ori-server/internal/model"
)

func TestCloneNodeWithEdgeLimitAppliesLimitAndMarksTruncated(t *testing.T) {
	source := &model.DatabaseNode{}
	source.SetTables([]string{"users", "orders", "events"})

	cloned := cloneNodeWithEdgeLimit(source, 2)
	node, ok := cloned.(*model.DatabaseNode)
	if !ok {
		t.Fatalf("expected *model.DatabaseNode clone")
	}

	if len(node.Tables) != 2 {
		t.Fatalf("expected 2 table IDs, got %d", len(node.Tables))
	}
	if !node.TablesTruncated {
		t.Fatalf("expected tables truncated flag to be true")
	}
	if len(source.Tables) != 3 {
		t.Fatalf("expected source table IDs to remain unchanged")
	}
}
