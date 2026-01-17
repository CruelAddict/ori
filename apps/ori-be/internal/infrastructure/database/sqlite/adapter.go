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
	config         *model.Configuration
	dbPath         string
	db             database.DB
}

// NewAdapter creates a factory that builds SQLite connection adapters
func NewAdapter(params service.AdapterFactoryParams) (service.ConnectionAdapter, error) {
	if params.Configuration.Database == "" {
		return nil, fmt.Errorf("sqlite configuration '%s' missing database path", params.ConnectionName)
	}

	path := params.Configuration.Database
	if !filepath.IsAbs(path) {
		path = filepath.Join(params.BaseDir, path)
	}
	path = filepath.Clean(path)

	return &Adapter{
		connectionName: params.ConnectionName,
		config:         params.Configuration,
		dbPath:         path,
	}, nil
}
