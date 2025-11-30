package sqlite

import (
	"context"
	"database/sql"
	"fmt"
)

// Connect establishes the database connection
func (a *Adapter) Connect(ctx context.Context) error {
	db, err := sql.Open("sqlite", a.dbPath)
	if err != nil {
		return fmt.Errorf("failed to open sqlite database: %w", err)
	}
	a.db = db
	return nil
}

// Close releases database resources
func (a *Adapter) Close() error {
	if a.db != nil {
		return a.db.Close()
	}
	return nil
}

// Ping checks database connectivity
func (a *Adapter) Ping(ctx context.Context) error {
	if a.db == nil {
		return fmt.Errorf("database not connected")
	}
	return a.db.PingContext(ctx)
}
