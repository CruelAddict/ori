package postgres

import (
	"context"
	"fmt"

	_ "github.com/jackc/pgx/v5/stdlib"

	"github.com/crueladdict/ori/apps/ori-server/internal/infrastructure/database/dblogged"
)

// Connect establishes the database connection
func (a *Adapter) Connect(ctx context.Context) error {
	// TODO: replace with DI
	db, err := dblogged.Open(ctx, "pgx", a.connString)
	if err != nil {
		return fmt.Errorf("failed to open postgresql database: %w", err)
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
