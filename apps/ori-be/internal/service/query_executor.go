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
	// Bootstrap returns the root nodes for the connection graph.
	Bootstrap(ctx context.Context) ([]*model.Node, error)
	// Hydrate enriches the provided node with additional data.
	Hydrate(ctx context.Context, target *model.Node) ([]*model.Node, error)
}
