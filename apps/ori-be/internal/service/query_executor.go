package service

import (
	"context"

	"github.com/crueladdict/ori/apps/ori-server/internal/model"
)

// QueryExecOptions contains options for query execution
type QueryExecOptions struct {
	MaxRows int `json:"maxRows"`
}

// AdapterFactoryParams bundles the information required to construct a connection adapter instance.
type AdapterFactoryParams struct {
	ConnectionName string
	Configuration  *model.Configuration
	BaseDir        string
}

// ConnectionAdapterFactory builds a new adapter instance for a connection.
type ConnectionAdapterFactory func(params AdapterFactoryParams) (ConnectionAdapter, error)

// Introspector provides methods for retrieving database metadata.
type Introspector interface {
	// GetScopes returns all available scopes (database + optional schema combinations).
	GetScopes(ctx context.Context) ([]model.Scope, error)

	// GetRelations returns tables and views within a scope.
	GetRelations(ctx context.Context, scope model.Scope) ([]model.Relation, error)

	// GetColumns returns columns for a relation within a scope.
	GetColumns(ctx context.Context, scope model.Scope, relation string) ([]model.Column, error)

	// GetConstraints returns constraints for a relation within a scope.
	GetConstraints(ctx context.Context, scope model.Scope, relation string) ([]model.Constraint, error)
	// GetIndexes returns indexes for a relation within a scope.
	GetIndexes(ctx context.Context, scope model.Scope, relation string) ([]model.Index, error)
	// GetTriggers returns triggers for a relation within a scope.
	GetTriggers(ctx context.Context, scope model.Scope, relation string) ([]model.Trigger, error)
}

// ConnectionAdapter represents a database-specific implementation capable of metadata discovery and query execution.
type ConnectionAdapter interface {
	// Connect establishes any underlying resources (e.g. database handles).
	Connect(ctx context.Context) error
	// Close releases resources held by the adapter.
	Close() error
	// Ping checks whether the connection remains healthy.
	Ping(ctx context.Context) error
	// ExecuteQuery runs a query and returns the result.
	ExecuteQuery(ctx context.Context, query string, params interface{}, options *QueryExecOptions) (*QueryResult, error)

	Introspector
}
