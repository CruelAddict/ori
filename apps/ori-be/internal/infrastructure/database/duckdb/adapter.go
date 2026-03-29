package duckdb

import (
	"fmt"
	"path/filepath"

	_ "github.com/duckdb/duckdb-go/v2"

	"github.com/crueladdict/ori/apps/ori-server/internal/infrastructure/database"
	"github.com/crueladdict/ori/apps/ori-server/internal/model"
	"github.com/crueladdict/ori/apps/ori-server/internal/service"
)

// Adapter implements service.ConnectionAdapter for DuckDB databases.
type Adapter struct {
	connectionName string
	config         *model.Resource
	dsn            string
	dbPath         string
	db             database.DB
}

// NewAdapter creates a factory that builds DuckDB connection adapters.
func NewAdapter(params service.AdapterFactoryParams) (service.ConnectionAdapter, error) {
	if params.Resource.Database == "" {
		return nil, fmt.Errorf("duckdb resource '%s' missing database path", params.ConnectionName)
	}

	input := params.Resource.Database
	dsn := input
	dbPath := input

	if !isInMemoryPath(input) {
		if !filepath.IsAbs(input) {
			input = filepath.Join(params.BaseDir, input)
		}
		input = filepath.Clean(input)
		dsn = input
		dbPath = input
	} else {
		dsn = ""
	}

	return &Adapter{
		connectionName: params.ConnectionName,
		config:         params.Resource,
		dsn:            dsn,
		dbPath:         dbPath,
	}, nil
}

func isInMemoryPath(path string) bool {
	return path == ":memory:"
}
