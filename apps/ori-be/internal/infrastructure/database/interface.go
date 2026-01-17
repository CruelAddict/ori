package database

import (
	"context"
	"database/sql"

	"github.com/jmoiron/sqlx"
)

// DB defines the database operations used by adapters.
type DB interface {
	GetContext(ctx context.Context, dest any, query string, args ...any) error
	SelectContext(ctx context.Context, dest any, query string, args ...any) error
	QueryxContext(ctx context.Context, query string, args ...any) (*sqlx.Rows, error)
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	PreparexContext(ctx context.Context, query string) (*sqlx.Stmt, error)
	NamedExecContext(ctx context.Context, query string, arg any) (sql.Result, error)
	NamedQueryContext(ctx context.Context, query string, arg any) (*sqlx.Rows, error)
	PingContext(ctx context.Context) error
	Close() error
}
