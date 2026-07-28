package service

import (
	"fmt"
	"testing"
	"time"
)

func TestResultStoreEvictsYoungEntriesWhenHardLimitsAreExceeded(t *testing.T) {
	maxRows := 100000
	store := NewResultStore(maxRows)
	now := time.Now()
	for i := 0; i <= maxResultEntries; i++ {
		store.Add(&QueryResult{
			JobID:      fmt.Sprintf("job-%d", i),
			Status:     JobStatusFailed,
			FinishedAt: now.Add(time.Duration(i) * time.Millisecond),
		})
	}
	if len(store.results) != maxResultEntries {
		t.Fatalf("stored entries = %d, want %d", len(store.results), maxResultEntries)
	}

	store = NewResultStore(maxRows)
	store.Add(&QueryResult{JobID: "first", Status: JobStatusSuccess, RowCount: 60000, FinishedAt: now})
	store.Add(&QueryResult{JobID: "second", Status: JobStatusSuccess, RowCount: 60000, FinishedAt: now.Add(time.Millisecond)})
	if _, ok := store.Get("first"); ok {
		t.Fatal("oldest result should be evicted even while it is young")
	}
	if _, ok := store.Get("second"); !ok {
		t.Fatal("newest result should remain available")
	}
}

func TestResultStoreExpiresTerminalJobs(t *testing.T) {
	store := NewResultStore(DefaultMaxMaterializedRows)
	store.results["expired"] = &QueryResult{
		JobID:      "expired",
		Status:     JobStatusSuccess,
		FinishedAt: time.Now().Add(-resultMaxAge),
	}

	if _, ok := store.Get("expired"); ok {
		t.Fatal("expired job should not remain in the store")
	}
}
