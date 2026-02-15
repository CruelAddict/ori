package sqlite

import (
	"fmt"
	"path/filepath"

	_ "modernc.org/sqlite"

	"github.com/crueladdict/ori/apps/ori-server/internal/infrastructure/database"
	"github.com/crueladdict/ori/apps/ori-server/internal/model"
	"github.com/crueladdict/ori/apps/ori-server/internal/service"
)

// Adapter implements service.ConnectionAdapter for SQLite databases.
type Adapter struct {
	connectionName string
	config         *model.Resource
	dbPath         string
	db             database.DB
}

// NewAdapter creates a factory that builds SQLite connection adapters
func NewAdapter(params service.AdapterFactoryParams) (service.ConnectionAdapter, error) {
	if params.Resource.Database == "" {
		return nil, fmt.Errorf("sqlite resource '%s' missing database path", params.ConnectionName)
	}

	path := params.Resource.Database
	if !filepath.IsAbs(path) {
		path = filepath.Join(params.BaseDir, path)
	}
	path = filepath.Clean(path)

	return &Adapter{
		connectionName: params.ConnectionName,
		config:         params.Resource,
		dbPath:         path,
	}, nil
}
