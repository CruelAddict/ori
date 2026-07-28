package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/crueladdict/ori/apps/ori-server/internal/events"
	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/logctx"
)

var (
	ErrNotFound          = errors.New("query result not found")
	ErrResultUnavailable = errors.New("query result is not available")
	ErrJobAlreadyExists  = errors.New("query job already exists")
	ErrJobNotFound       = errors.New("query job not found")
	ErrMaxRowsExceeded   = errors.New("query max rows exceeds the current materialization limit")
)

const DefaultMaxMaterializedRows = 100000

// QueryResultView represents a paginated view of query results
type QueryResultView struct {
	Columns      []QueryColumn `json:"columns"`
	Rows         [][]any       `json:"rows"`
	RowCount     int           `json:"rowCount"`
	Truncated    bool          `json:"truncated"`
	RowsAffected *int64        `json:"rowsAffected,omitempty"`
}

type QueryJobStatus struct {
	JobID        string
	ResourceName string
	Status       JobStatus
	FinishedAt   *time.Time
	DurationMs   *int64
	Error        string
	Stored       bool
}

// QueryService manages query job execution
type QueryService struct {
	connectionService   *ResourceSessionService
	eventHub            *events.Hub
	resultStore         *ResultStore
	mu                  sync.RWMutex
	activeJobs          map[string]*QueryJob
	rootCtx             context.Context
	maxMaterializedRows int
}

// NewQueryService creates a new query service
func NewQueryService(connectionService *ResourceSessionService, eventHub *events.Hub, rootCtx context.Context, maxMaterializedRows int) *QueryService {
	return &QueryService{
		connectionService:   connectionService,
		eventHub:            eventHub,
		resultStore:         NewResultStore(maxMaterializedRows),
		activeJobs:          make(map[string]*QueryJob),
		rootCtx:             rootCtx,
		maxMaterializedRows: maxMaterializedRows,
	}
}

func (qs *QueryService) newJobContext(ctx context.Context) context.Context {
	jobCtx := qs.rootCtx
	if jobCtx == nil {
		jobCtx = context.Background()
	}
	for _, attr := range logctx.Attrs(ctx) {
		jobCtx = logctx.WithAttrs(jobCtx, attr)
	}
	return jobCtx
}

// Exec starts execution of a database query asynchronously
func (qs *QueryService) Exec(ctx context.Context, resourceName, jobID, query string, params interface{}, options *QueryExecOptions) (*QueryJob, error) {
	jobID = strings.TrimSpace(jobID)
	if jobID == "" {
		return nil, fmt.Errorf("job ID cannot be empty")
	}
	if _, err := uuid.Parse(jobID); err != nil {
		return nil, fmt.Errorf("invalid job ID: %w", err)
	}

	// Set default options
	if options == nil {
		options = &QueryExecOptions{}
	}
	if options.MaxRows <= 0 {
		options.MaxRows = qs.maxMaterializedRows
	}

	if options.MaxRows > qs.maxMaterializedRows {
		return nil, fmt.Errorf("%w: requested %d, maximum %d", ErrMaxRowsExceeded, options.MaxRows, qs.maxMaterializedRows)
	}

	// Check if connection is available
	handle, ok := qs.connectionService.GetConnection(resourceName)
	if !ok || handle == nil || handle.Adapter == nil {
		return nil, fmt.Errorf("%w: %s", ErrConnectionUnavailable, resourceName)
	}

	// Create job
	job := &QueryJob{
		ID:           jobID,
		ResourceName: resourceName,
		Query:        query,
		Params:       params,
		Options:      options,
		Status:       JobStatusRunning,
		CreatedAt:    time.Now(),
	}

	// Create cancellable context for this job, independent of request lifecycle
	jobCtx := qs.newJobContext(ctx)
	jobCtx, cancel := context.WithCancel(jobCtx)
	job.Cancel = cancel

	// Store job
	qs.mu.Lock()
	if _, exists := qs.activeJobs[jobID]; exists {
		qs.mu.Unlock()
		return nil, ErrJobAlreadyExists
	}
	qs.activeJobs[jobID] = job
	qs.mu.Unlock()

	// Start execution in goroutine
	go qs.runJob(jobCtx, job, handle)

	return job, nil
}

func (qs *QueryService) GetStatus(jobID string) (*QueryJobStatus, error) {
	qs.mu.RLock()
	job, ok := qs.activeJobs[jobID]
	if ok {
		status := &QueryJobStatus{
			JobID:        job.ID,
			ResourceName: job.ResourceName,
			Status:       job.Status,
			FinishedAt:   job.FinishedAt,
			Error:        job.Error,
		}
		if job.FinishedAt != nil {
			duration := job.DurationMs
			status.DurationMs = &duration
		}
		qs.mu.RUnlock()
		return status, nil
	}
	qs.mu.RUnlock()

	result, ok := qs.resultStore.Get(jobID)
	if !ok {
		return nil, ErrJobNotFound
	}
	duration := result.DurationMs
	finishedAt := result.FinishedAt
	return &QueryJobStatus{
		JobID:        result.JobID,
		ResourceName: result.ResourceName,
		Status:       result.Status,
		FinishedAt:   &finishedAt,
		DurationMs:   &duration,
		Error:        result.Error,
		Stored:       result.Status == JobStatusSuccess,
	}, nil
}

// BuildResultView builds a paginated view of a stored query result
func (qs *QueryService) BuildResultView(ctx context.Context, jobID string, limit, offset *int) (*QueryResultView, error) {
	result, exists := qs.resultStore.Get(jobID)
	if !exists {
		return nil, ErrNotFound
	}
	if result.Status != JobStatusSuccess {
		return nil, ErrResultUnavailable
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

	paginatedRows := make([][]any, 0)
	if start < result.RowCount {
		paginatedRows = result.Rows[start:end]
	}

	columns := result.Columns
	if columns == nil {
		columns = make([]QueryColumn, 0)
	}

	view := &QueryResultView{
		Columns:      columns,
		Rows:         paginatedRows,
		RowCount:     result.RowCount,
		Truncated:    result.Truncated,
		RowsAffected: result.RowsAffected,
	}

	return view, nil
}

// Cancel cancels a running job.
func (qs *QueryService) Cancel(jobID string) error {
	qs.mu.Lock()
	job, ok := qs.activeJobs[jobID]
	if !ok {
		qs.mu.Unlock()
		return ErrJobNotFound
	}
	if job.Status != JobStatusRunning {
		qs.mu.Unlock()
		return nil
	}
	cancel := job.Cancel
	qs.mu.Unlock()

	cancel()
	return nil
}

// Stop cancels all running jobs
func (qs *QueryService) Stop() {
	qs.mu.Lock()
	defer qs.mu.Unlock()

	for _, job := range qs.activeJobs {
		if job.Status == JobStatusRunning {
			job.Cancel()
		}
	}
}

// runJob executes a query job
func (qs *QueryService) runJob(ctx context.Context, job *QueryJob, handle *ResourceHandle) {
	startTime := time.Now()
	qs.mu.Lock()
	job.StartedAt = &startTime
	qs.mu.Unlock()

	result, err := handle.Adapter.ExecuteQuery(ctx, job.Query, job.Params, job.Options)
	finishTime := time.Now()
	status := JobStatusSuccess
	errorMessage := ""
	if err != nil {
		if ctx.Err() != nil {
			status = JobStatusCanceled
			errorMessage = ctx.Err().Error()
		} else {
			status = JobStatusFailed
			errorMessage = err.Error()
		}
	}

	duration := finishTime.Sub(startTime).Milliseconds()
	if result == nil {
		result = &QueryResult{}
	}
	result.JobID = job.ID
	result.ResourceName = job.ResourceName
	result.Status = status
	result.Error = errorMessage
	result.FinishedAt = finishTime
	result.DurationMs = duration
	qs.resultStore.Add(result)

	qs.mu.Lock()
	job.Status = status
	job.Error = errorMessage
	job.FinishedAt = &finishTime
	job.DurationMs = duration
	delete(qs.activeJobs, job.ID)
	qs.mu.Unlock()
	qs.emitJobCompletion(job)
}

// emitJobCompletion emits a job completion event via SSE
func (qs *QueryService) emitJobCompletion(job *QueryJob) {
	if qs.eventHub == nil {
		return
	}

	payload := events.QueryJobCompletedPayload{
		JobID:        job.ID,
		ResourceName: job.ResourceName,
		Status:       string(job.Status),
		FinishedAt:   job.FinishedAt.Format(time.RFC3339),
		DurationMs:   job.DurationMs,
	}

	if job.Error != "" {
		payload.Error = job.Error
	}

	if job.Status == JobStatusSuccess {
		if _, stored := qs.resultStore.Get(job.ID); stored {
			payload.Stored = true
		}
	}

	qs.eventHub.Publish(events.Event{
		Name:    events.QueryJobCompletedEvent,
		Payload: payload,
	})
}
