package duckdb

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/crueladdict/ori/apps/ori-server/internal/infrastructure/database/dblogged"
)

// Connect establishes the database connection.
func (a *Adapter) Connect(ctx context.Context) error {
	raw, err := sql.Open("duckdb", a.dsn)
	if err != nil {
		return fmt.Errorf("failed to open duckdb database: %w", err)
	}
	raw.SetMaxOpenConns(1)
	raw.SetMaxIdleConns(1)

	a.db = dblogged.New(raw, "duckdb")
	if err := a.db.PingContext(ctx); err != nil {
		_ = raw.Close()
		a.db = nil
		return fmt.Errorf("failed to ping duckdb database: %w", err)
	}
	return nil
}

// Close releases database resources.
func (a *Adapter) Close() error {
	if a.db != nil {
		return a.db.Close()
	}
	return nil
}

// Ping checks database connectivity.
func (a *Adapter) Ping(ctx context.Context) error {
	if a.db == nil {
		return fmt.Errorf("database not connected")
	}
	return a.db.PingContext(ctx)
}
