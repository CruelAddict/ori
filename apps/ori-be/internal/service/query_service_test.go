package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/crueladdict/ori/apps/ori-server/internal/model"
	"github.com/google/uuid"
)

type testQueryAdapter struct {
	execute func(context.Context) (*QueryResult, error)
}

func (a testQueryAdapter) Connect(context.Context) error { return nil }
func (a testQueryAdapter) Close() error                  { return nil }
func (a testQueryAdapter) Ping(context.Context) error    { return nil }
func (a testQueryAdapter) ExecuteQuery(ctx context.Context, _ string, _ interface{}, _ *QueryExecOptions) (*QueryResult, error) {
	return a.execute(ctx)
}
func (a testQueryAdapter) GetScopes(context.Context) ([]model.Scope, error) { return nil, nil }
func (a testQueryAdapter) GetRelations(context.Context, model.Scope) ([]model.Relation, error) {
	return nil, nil
}
func (a testQueryAdapter) GetColumns(context.Context, model.Scope, string) ([]model.Column, error) {
	return nil, nil
}
func (a testQueryAdapter) GetConstraints(context.Context, model.Scope, string) ([]model.Constraint, error) {
	return nil, nil
}
func (a testQueryAdapter) GetIndexes(context.Context, model.Scope, string) ([]model.Index, error) {
	return nil, nil
}
func (a testQueryAdapter) GetTriggers(context.Context, model.Scope, string) ([]model.Trigger, error) {
	return nil, nil
}

func TestQueryServiceGetStatusReadsActiveAndTerminalJobs(t *testing.T) {
	service := &QueryService{
		activeJobs:  map[string]*QueryJob{},
		resultStore: NewResultStore(DefaultMaxMaterializedRows),
	}
	service.activeJobs["running"] = &QueryJob{
		ID:           "running",
		ResourceName: "local",
		Status:       JobStatusRunning,
	}

	running, err := service.GetStatus("running")
	if err != nil {
		t.Fatalf("get running status: %v", err)
	}
	if running.Status != JobStatusRunning || running.Stored {
		t.Fatalf("running status = %#v", running)
	}

	service.resultStore.Add(&QueryResult{
		JobID:        "finished",
		ResourceName: "local",
		Status:       JobStatusSuccess,
		FinishedAt:   time.Now(),
		DurationMs:   12,
	})
	finished, err := service.GetStatus("finished")
	if err != nil {
		t.Fatalf("get terminal status: %v", err)
	}
	if finished.Status != JobStatusSuccess || !finished.Stored || finished.DurationMs == nil {
		t.Fatalf("terminal status = %#v", finished)
	}
}

func TestQueryServiceRespectsConfiguredMaterializationLimit(t *testing.T) {
	maxRows := 10
	connectionService := &ResourceSessionService{connections: map[string]*ResourceHandle{}}
	jobID := uuid.NewString()

	limited := NewQueryService(connectionService, nil, context.Background(), maxRows)
	_, err := limited.Exec(context.Background(), "local", jobID, "SELECT 1", nil, &QueryExecOptions{MaxRows: 11})
	if !errors.Is(err, ErrMaxRowsExceeded) {
		t.Fatalf("limited query error = %v, want ErrMaxRowsExceeded", err)
	}
}

func TestQueryServiceKeepsSuccessfulResultWhenCancellationRacesWithCompletion(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	service := &QueryService{
		activeJobs:  map[string]*QueryJob{},
		resultStore: NewResultStore(DefaultMaxMaterializedRows),
	}
	job := &QueryJob{ID: "job", ResourceName: "local", Status: JobStatusRunning}
	handle := &ResourceHandle{Adapter: testQueryAdapter{
		execute: func(context.Context) (*QueryResult, error) {
			cancel()
			return &QueryResult{}, nil
		},
	}}

	service.runJob(ctx, job, handle)

	if job.Status != JobStatusSuccess {
		t.Fatalf("job status = %s, want %s", job.Status, JobStatusSuccess)
	}
	result, ok := service.resultStore.Get(job.ID)
	if !ok || result.Status != JobStatusSuccess {
		t.Fatalf("stored result = %#v, want successful result", result)
	}
}
