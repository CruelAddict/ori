package dblogged

import (
	"context"
	"database/sql"
	"log/slog"
	"time"

	"github.com/jmoiron/sqlx"

	"github.com/crueladdict/ori/apps/ori-server/internal/infrastructure/database"
	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/logctx"
)

const (
	keyOperation  = "operation"
	keyParamCount = "paramCount"
	keyDuration   = "duration"

	operationOpen     = "open"
	operationQuery    = "query"
	operationQueryRow = "query_row"
	operationExec     = "exec"
	operationPrepare  = "prepare"
	operationPing     = "ping"
	operationClose    = "close"
)

type DB struct {
	db database.DB
}

func Open(ctx context.Context, driver, dsn string) (*DB, error) {
	ctx = logctx.WithField(ctx, keyOperation, operationOpen)
	var err error
	start := time.Now()
	defer func() {
		logFinish(ctx, start, err)
	}()
	var raw *sql.DB
	raw, err = sql.Open(driver, dsn)
	if err != nil {
		return nil, err
	}
	slog.InfoContext(ctx, "database connected", slog.String("driver", driver))
	return &DB{db: sqlx.NewDb(raw, driver)}, nil
}

func New(db *sql.DB, driver string) *DB {
	return &DB{db: sqlx.NewDb(db, driver)}
}

func (d *DB) GetContext(ctx context.Context, dest any, query string, args ...any) (err error) {
	start := time.Now()
	ctx = logctx.WithFields(ctx, map[string]any{
		keyParamCount: len(args),
		keyOperation:  operationQueryRow,
	})
	defer func() {
		logFinish(ctx, start, err)
	}()
	err = d.db.GetContext(ctx, dest, query, args...)
	return err
}

func (d *DB) SelectContext(ctx context.Context, dest any, query string, args ...any) (err error) {
	start := time.Now()
	ctx = logctx.WithFields(ctx, map[string]any{
		keyParamCount: len(args),
		keyOperation:  operationQuery,
	})
	defer func() {
		logFinish(ctx, start, err)
	}()
	err = d.db.SelectContext(ctx, dest, query, args...)
	return err
}

func (d *DB) QueryxContext(ctx context.Context, query string, args ...any) (rows *sqlx.Rows, err error) {
	start := time.Now()
	ctx = logctx.WithFields(ctx, map[string]any{
		keyParamCount: len(args),
		keyOperation:  operationQuery,
	})
	defer func() {
		logFinish(ctx, start, err)
	}()
	rows, err = d.db.QueryxContext(ctx, query, args...)
	return rows, err
}

func (d *DB) ExecContext(ctx context.Context, query string, args ...any) (result sql.Result, err error) {
	start := time.Now()
	ctx = logctx.WithFields(ctx, map[string]any{
		keyParamCount: len(args),
		keyOperation:  operationExec,
	})
	defer func() {
		logFinish(ctx, start, err)
	}()
	result, err = d.db.ExecContext(ctx, query, args...)
	return result, err
}

func (d *DB) PreparexContext(ctx context.Context, query string) (stmt *sqlx.Stmt, err error) {
	start := time.Now()
	ctx = logctx.WithField(ctx, keyOperation, operationPrepare)
	defer func() {
		logFinish(ctx, start, err)
	}()
	stmt, err = d.db.PreparexContext(ctx, query)
	return stmt, err
}

func (d *DB) NamedExecContext(ctx context.Context, query string, arg any) (result sql.Result, err error) {
	start := time.Now()
	ctx = logctx.WithField(ctx, keyOperation, operationExec)
	defer func() {
		logFinish(ctx, start, err)
	}()
	result, err = d.db.NamedExecContext(ctx, query, arg)
	return result, err
}

func (d *DB) NamedQueryContext(ctx context.Context, query string, arg any) (rows *sqlx.Rows, err error) {
	start := time.Now()
	ctx = logctx.WithField(ctx, keyOperation, operationQuery)
	defer func() {
		logFinish(ctx, start, err)
	}()
	rows, err = d.db.NamedQueryContext(ctx, query, arg)
	return rows, err
}

func (d *DB) PingContext(ctx context.Context) (err error) {
	start := time.Now()
	ctx = logctx.WithField(ctx, keyOperation, operationPing)
	defer func() {
		logFinish(ctx, start, err)
	}()
	err = d.db.PingContext(ctx)
	return err
}

func (d *DB) Close() (err error) {
	start := time.Now()
	ctx := context.Background()
	ctx = logctx.WithField(ctx, keyOperation, operationClose)
	defer func() {
		logFinish(ctx, start, err)
	}()
	err = d.db.Close()
	return err
}

func logFinish(ctx context.Context, start time.Time, err error) {
	ctx = logctx.WithAttrs(ctx, slog.Duration(keyDuration, time.Since(start)))
	if err != nil {
		ctx = logctx.WithAttrs(ctx, slog.Any("err", err))
		slog.ErrorContext(ctx, "database call failed")
		return
	}
	slog.InfoContext(ctx, "db call finished")
}
