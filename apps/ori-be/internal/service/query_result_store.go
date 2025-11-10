package service

import (
	"log/slog"
	"sync"
	"time"
)

const (
	DefaultMaxRows = 200
	HardMaxRows    = 1000
)

// ResultStore manages storage and cleanup of query results
type ResultStore struct {
	mu                sync.RWMutex
	results           map[string]*QueryResult
	maxCumulativeRows int
	minAge            time.Duration
}

// NewResultStore creates a new result store
func NewResultStore() *ResultStore {
	return &ResultStore{
		results:           make(map[string]*QueryResult),
		maxCumulativeRows: 1000,             // Maximum cumulative rows
		minAge:            10 * time.Minute, // Minimum age before cleanup
	}
}

// Add stores a query result and runs cleanup if needed
func (s *ResultStore) Add(result *QueryResult) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.results[result.JobID] = result

	slog.Info("Query result stored",
		slog.String("jobId", result.JobID),
		slog.String("configuration", result.ConfigurationName),
		slog.Int("rowCount", result.RowCount),
		slog.Bool("truncated", result.Truncated))

	// Run cleanup if we exceed limits
	s.cleanup()
}

// Get retrieves a query result by job ID
func (s *ResultStore) Get(jobID string) (*QueryResult, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result, ok := s.results[jobID]
	return result, ok
}

// cleanup removes old results while respecting the minimum age policy
func (s *ResultStore) cleanup() {
	// Calculate total rows
	totalRows := 0
	for _, result := range s.results {
		totalRows += result.RowCount
	}

	// If we're under the limit, no cleanup needed
	if totalRows <= s.maxCumulativeRows {
		return
	}

	// Sort results by completion time (oldest first)
	type resultWithTime struct {
		result *QueryResult
		time   time.Time
	}

	var sorted []resultWithTime
	for _, result := range s.results {
		sorted = append(sorted, resultWithTime{
			result: result,
			time:   result.FinishedAt,
		})
	}

	// Simple bubble sort - good enough for small number of results
	for i := 0; i < len(sorted)-1; i++ {
		for j := 0; j < len(sorted)-i-1; j++ {
			if sorted[j].time.After(sorted[j+1].time) {
				sorted[j], sorted[j+1] = sorted[j+1], sorted[j]
			}
		}
	}

	// Remove oldest results until we're under the limit, but don't remove results younger than minAge
	now := time.Now()
	for _, item := range sorted {
		if totalRows <= s.maxCumulativeRows {
			break
		}

		// Don't remove results younger than minAge
		if now.Sub(item.time) < s.minAge {
			continue
		}

		// Remove this result
		delete(s.results, item.result.JobID)
		totalRows -= item.result.RowCount

		slog.Info("Query result evicted from cache",
			slog.String("jobId", item.result.JobID),
			slog.String("configuration", item.result.ConfigurationName),
			slog.Int("rowCount", item.result.RowCount),
			slog.Duration("age", now.Sub(item.time)))
	}
}
