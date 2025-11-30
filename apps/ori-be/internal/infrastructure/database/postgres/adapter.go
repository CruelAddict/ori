package postgres

import (
	"database/sql"
	"fmt"
	"net/url"

	"github.com/crueladdict/ori/apps/ori-server/internal/model"
	"github.com/crueladdict/ori/apps/ori-server/internal/service"
)

// Adapter implements service.ConnectionAdapter for PostgreSQL databases.
type Adapter struct {
	connectionName string
	config         *model.Configuration
	connString     string
	db             *sql.DB
}

// NewAdapter creates a factory that builds PostgreSQL connection adapters
func NewAdapter(params service.AdapterFactoryParams) (service.ConnectionAdapter, error) {
	cfg := params.Configuration

	if cfg.Host == nil || *cfg.Host == "" {
		return nil, fmt.Errorf("postgresql configuration '%s' missing host", params.ConnectionName)
	}
	if cfg.Port == nil || *cfg.Port == 0 {
		return nil, fmt.Errorf("postgresql configuration '%s' missing port", params.ConnectionName)
	}
	if cfg.Database == "" {
		return nil, fmt.Errorf("postgresql configuration '%s' missing database", params.ConnectionName)
	}
	if cfg.Username == nil || *cfg.Username == "" {
		return nil, fmt.Errorf("postgresql configuration '%s' missing username", params.ConnectionName)
	}

	// Resolve password
	password := ""
	if cfg.Password != nil {
		pwdService := service.NewPasswordService()
		resolved, err := pwdService.Resolve(cfg.Password)
		if err != nil {
			return nil, fmt.Errorf("postgresql configuration '%s' password resolution failed: %w", params.ConnectionName, err)
		}
		password = resolved
	}

	// Build connection string
	connString := buildConnectionString(*cfg.Host, *cfg.Port, cfg.Database, *cfg.Username, password)

	return &Adapter{
		connectionName: params.ConnectionName,
		config:         cfg,
		connString:     connString,
	}, nil
}

// buildConnectionString creates a PostgreSQL connection URL
func buildConnectionString(host string, port int, database, username, password string) string {
	u := &url.URL{
		Scheme: "postgres",
		Host:   fmt.Sprintf("%s:%d", host, port),
		Path:   database,
	}

	if password != "" {
		u.User = url.UserPassword(username, password)
	} else {
		u.User = url.User(username)
	}

	// Default to disable SSL for local development; can be made configurable
	q := u.Query()
	q.Set("sslmode", "disable")
	u.RawQuery = q.Encode()

	return u.String()
}
