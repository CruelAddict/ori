package service

import (
	"context"
	"time"
)

// JobStatus represents the status of a query job
type JobStatus string

const (
	JobStatusRunning  JobStatus = "running"
	JobStatusSuccess  JobStatus = "success"
	JobStatusFailed   JobStatus = "failed"
	JobStatusCanceled JobStatus = "canceled"
)

// QueryJob represents an asynchronous query execution job
type QueryJob struct {
	ID           string
	ResourceName string
	Query        string
	Params       any // Can be map[string]interface{} or []interface{}
	Options      *QueryExecOptions
	Status       JobStatus
	CreatedAt    time.Time
	StartedAt    *time.Time
	FinishedAt   *time.Time
	DurationMs   int64
	Error        string
	Cancel       context.CancelFunc
}

// QueryColumn represents column metadata for query results
type QueryColumn struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

// QueryResult represents the result of a query execution
type QueryResult struct {
	JobID        string
	ResourceName string
	Status       JobStatus
	Columns      []QueryColumn
	Rows         [][]any
	RowCount     int
	Truncated    bool
	RowsAffected *int64
	Error        string
	FinishedAt   time.Time
	DurationMs   int64
}
