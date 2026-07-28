package service

import (
	"log/slog"
	"sort"
	"sync"
	"time"
)

const (
	maxResultEntries = 128
	resultMaxAge     = 10 * time.Minute
)

// ResultStore keeps a bounded set of terminal jobs and their result payloads.
type ResultStore struct {
	mu                sync.Mutex
	results           map[string]*QueryResult
	maxCumulativeRows int
	maxEntries        int
	maxAge            time.Duration
}

func NewResultStore(maxCumulativeRows int) *ResultStore {
	return &ResultStore{
		results:           make(map[string]*QueryResult),
		maxCumulativeRows: maxCumulativeRows,
		maxEntries:        maxResultEntries,
		maxAge:            resultMaxAge,
	}
}

func (s *ResultStore) Add(result *QueryResult) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.results[result.JobID] = result
	s.cleanup(time.Now())

	slog.Info("Query result stored",
		slog.String("jobId", result.JobID),
		slog.String("resource", result.ResourceName),
		slog.Int("rowCount", result.RowCount),
		slog.Bool("truncated", result.Truncated))
}

func (s *ResultStore) Get(jobID string) (*QueryResult, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cleanup(time.Now())

	result, ok := s.results[jobID]
	return result, ok
}

func (s *ResultStore) cleanup(now time.Time) {
	totalRows := 0
	sorted := make([]*QueryResult, 0, len(s.results))
	for _, result := range s.results {
		if now.Sub(result.FinishedAt) >= s.maxAge {
			delete(s.results, result.JobID)
			continue
		}
		totalRows += result.RowCount
		sorted = append(sorted, result)
	}

	if totalRows <= s.maxCumulativeRows && len(sorted) <= s.maxEntries {
		return
	}

	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].FinishedAt.Before(sorted[j].FinishedAt)
	})
	for _, result := range sorted {
		if totalRows <= s.maxCumulativeRows && len(s.results) <= s.maxEntries {
			break
		}
		delete(s.results, result.JobID)
		totalRows -= result.RowCount
		slog.Info("Query result evicted from cache",
			slog.String("jobId", result.JobID),
			slog.String("resource", result.ResourceName),
			slog.Int("rowCount", result.RowCount),
			slog.Duration("age", now.Sub(result.FinishedAt)))
	}
}
