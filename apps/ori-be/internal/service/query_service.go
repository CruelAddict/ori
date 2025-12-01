package service

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/crueladdict/ori/apps/ori-server/internal/events"
)

var (
	ErrNotFound = errors.New("query result not found")
)

// QueryResultView represents a paginated view of query results
type QueryResultView struct {
	Columns   []QueryColumn `json:"columns"`
	Rows      [][]any       `json:"rows"`
	RowCount  int           `json:"rowCount"`
	Truncated bool          `json:"truncated"`
}

// QueryService manages query job execution
type QueryService struct {
	connectionService *ConnectionService
	eventHub          *events.Hub
	resultStore       *ResultStore
	mu                sync.RWMutex
	activeJobs        map[string]*QueryJob
	rootCtx           context.Context
}

// NewQueryService creates a new query service
func NewQueryService(connectionService *ConnectionService, eventHub *events.Hub, rootCtx context.Context) *QueryService {
	return &QueryService{
		connectionService: connectionService,
		eventHub:          eventHub,
		resultStore:       NewResultStore(),
		activeJobs:        make(map[string]*QueryJob),
		rootCtx:           rootCtx,
	}
}

// Exec starts execution of a database query asynchronously
func (qs *QueryService) Exec(configurationName, query string, params interface{}, options *QueryExecOptions) (*QueryJob, error) {
	// Set default options
	if options == nil {
		options = &QueryExecOptions{MaxRows: DefaultMaxRows}
	}
	if options.MaxRows <= 0 {
		options.MaxRows = DefaultMaxRows
	}
	if options.MaxRows > HardMaxRows {
		options.MaxRows = HardMaxRows
	}

	// Check if connection is available
	handle, ok := qs.connectionService.GetConnection(configurationName)
	if !ok || handle == nil || handle.Adapter == nil {
		return nil, fmt.Errorf("%w: %s", ErrConnectionUnavailable, configurationName)
	}

	// Create job
	jobID := uuid.New().String()
	job := &QueryJob{
		ID:                jobID,
		ConfigurationName: configurationName,
		Query:             query,
		Params:            params,
		Options:           options,
		Status:            JobStatusRunning,
		CreatedAt:         time.Now(),
	}

	// Create cancellable context for this job
	jobCtx, cancel := context.WithCancel(qs.rootCtx)
	job.Cancel = cancel

	// Store job
	qs.mu.Lock()
	qs.activeJobs[jobID] = job
	qs.mu.Unlock()

	// Start execution in goroutine
	go qs.runJob(jobCtx, job, handle)

	return job, nil
}

// GetActiveJob retrieves a job by ID
func (qs *QueryService) GetActiveJob(jobID string) (*QueryJob, bool) {
	qs.mu.RLock()
	defer qs.mu.RUnlock()

	job, ok := qs.activeJobs[jobID]
	return job, ok
}

// BuildResultView builds a paginated view of a stored query result
func (qs *QueryService) BuildResultView(jobID string, limit, offset *int) (*QueryResultView, error) {
	result, exists := qs.resultStore.Get(jobID)
	if !exists {
		return nil, ErrNotFound
	}

	if offset != nil && *offset < 0 {
		return nil, fmt.Errorf("offset cannot be negative")
	}
	if limit != nil && *limit <= 0 {
		return nil, fmt.Errorf("limit must be positive")
	}

	// Apply defaults
	actualOffset := 0
	if offset != nil {
		actualOffset = *offset
	}
	actualLimit := result.RowCount
	if limit != nil {
		actualLimit = *limit
	}

	start := actualOffset
	end := actualOffset + actualLimit
	if start > result.RowCount {
		start = result.RowCount
	}
	if end > result.RowCount {
		end = result.RowCount
	}

	var paginatedRows [][]any
	if start < result.RowCount {
		paginatedRows = result.Rows[start:end]
	}

	view := &QueryResultView{
		Columns:   result.Columns,
		Rows:      paginatedRows,
		RowCount:  result.RowCount,
		Truncated: result.Truncated,
	}

	return view, nil
}

// Stop cancels all running jobs
func (qs *QueryService) Stop() {
	qs.mu.Lock()
	defer qs.mu.Unlock()

	for _, job := range qs.activeJobs {
		if job.Status == JobStatusRunning {
			job.Cancel()
			job.Status = JobStatusCanceled
			job.FinishedAt = &[]time.Time{time.Now()}[0]
			if job.StartedAt != nil {
				job.DurationMs = job.FinishedAt.Sub(*job.StartedAt).Milliseconds()
			}

			// Emit completion event for canceled job
			qs.emitJobCompletion(job)
		}
	}
}

// runJob executes a query job
func (qs *QueryService) runJob(ctx context.Context, job *QueryJob, handle *ConnectionHandle) {
	startTime := time.Now()
	job.StartedAt = &startTime

	defer func() {
		finishTime := time.Now()
		job.FinishedAt = &finishTime
		if job.StartedAt != nil {
			job.DurationMs = finishTime.Sub(*job.StartedAt).Milliseconds()
		}

		// Remove from active jobs
		qs.mu.Lock()
		delete(qs.activeJobs, job.ID)
		qs.mu.Unlock()

		// Emit completion event
		qs.emitJobCompletion(job)
	}()

	// Execute the query using the connection adapter
	result, err := handle.Adapter.ExecuteQuery(ctx, job.Query, job.Params, job.Options)
	if err != nil {
		job.Status = JobStatusFailed
		job.Error = err.Error()

		// Store failed result (FinishedAt will be set by defer)
		finishTime := time.Now()
		failedResult := &QueryResult{
			JobID:             job.ID,
			ConfigurationName: job.ConfigurationName,
			Status:            JobStatusFailed,
			Error:             err.Error(),
			FinishedAt:        finishTime,
			DurationMs:        finishTime.Sub(*job.StartedAt).Milliseconds(),
		}
		qs.resultStore.Add(failedResult)
		return
	}

	// Fill in job metadata for the result
	finishTime := time.Now()
	result.JobID = job.ID
	result.ConfigurationName = job.ConfigurationName
	result.FinishedAt = finishTime
	result.DurationMs = finishTime.Sub(*job.StartedAt).Milliseconds()

	// Store successful result
	qs.resultStore.Add(result)
	job.Status = JobStatusSuccess
}

// emitJobCompletion emits a job completion event via SSE
func (qs *QueryService) emitJobCompletion(job *QueryJob) {
	if qs.eventHub == nil {
		return
	}

	payload := events.QueryJobCompletedPayload{
		JobID:             job.ID,
		ConfigurationName: job.ConfigurationName,
		Status:            string(job.Status),
		FinishedAt:        job.FinishedAt.Format(time.RFC3339),
		DurationMs:        job.DurationMs,
	}

	if job.Error != "" {
		payload.Error = job.Error
	}

	// Check if result is stored
	if _, stored := qs.resultStore.Get(job.ID); stored {
		payload.Stored = true
	}

	qs.eventHub.Publish(events.Event{
		Name:    events.QueryJobCompletedEvent,
		Payload: payload,
	})
}
