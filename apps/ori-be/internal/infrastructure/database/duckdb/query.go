package duckdb

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/querycell"
	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/sqlutil"
	"github.com/crueladdict/ori/apps/ori-server/internal/service"
	"github.com/jmoiron/sqlx"
)

// ExecuteQuery runs a query and returns the result.
func (a *Adapter) ExecuteQuery(ctx context.Context, query string, params any, options *service.QueryExecOptions) (*service.QueryResult, error) {
	if a.db == nil {
		return nil, fmt.Errorf("database not connected")
	}

	var stmt *sqlx.Stmt
	var err error

	if params != nil {
		stmt, err = a.db.PreparexContext(ctx, query)
		if err != nil {
			return nil, fmt.Errorf("failed to prepare query: %w", err)
		}
		defer func() {
			_ = stmt.Close()
		}()
	}

	if sqlutil.IsRowReturningQuery(query) {
		return a.executeSelect(ctx, stmt, query, params, options)
	}
	return a.executeStatement(ctx, stmt, query, params)
}

func (a *Adapter) executeSelect(ctx context.Context, stmt *sqlx.Stmt, query string, params any, options *service.QueryExecOptions) (*service.QueryResult, error) {
	var rows *sqlx.Rows
	var err error

	if stmt != nil {
		rows, err = queryWithParams(ctx, stmt, params)
	} else {
		rows, err = a.db.QueryxContext(ctx, query)
	}
	if err != nil {
		return nil, fmt.Errorf("query execution failed: %w", err)
	}
	defer func() {
		_ = rows.Close()
	}()

	columns, err := rows.Columns()
	if err != nil {
		return nil, fmt.Errorf("failed to get columns: %w", err)
	}

	columnTypes, err := rows.ColumnTypes()
	if err != nil {
		return nil, fmt.Errorf("failed to get column types: %w", err)
	}

	queryColumns := make([]service.QueryColumn, len(columns))
	for i, name := range columns {
		colType := "unknown"
		if i < len(columnTypes) {
			dbType := columnTypes[i].DatabaseTypeName()
			if dbType != "" {
				colType = dbType
			}
		}
		queryColumns[i] = service.QueryColumn{Name: name, Type: colType}
	}

	rowData := make([]any, len(columns))
	rowPtrs := make([]any, len(columns))
	for i := range rowData {
		rowPtrs[i] = &rowData[i]
	}

	var allRows [][]any
	rowCount := 0
	truncated := false

	for rows.Next() {
		if err := rows.Scan(rowPtrs...); err != nil {
			return nil, fmt.Errorf("failed to scan row: %w", err)
		}

		rowCopy := make([]any, len(rowData))
		for i, value := range rowData {
			rowCopy[i] = querycell.Stringify(value)
		}

		allRows = append(allRows, rowCopy)
		rowCount++

		if rowCount >= options.MaxRows {
			if rows.Next() {
				truncated = true
			}
			break
		}
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("row iteration error: %w", err)
	}

	return &service.QueryResult{
		Status:    service.JobStatusSuccess,
		Columns:   queryColumns,
		Rows:      allRows,
		RowCount:  rowCount,
		Truncated: truncated,
	}, nil
}

func (a *Adapter) executeStatement(ctx context.Context, stmt *sqlx.Stmt, query string, params any) (*service.QueryResult, error) {
	var result sql.Result
	var err error

	if stmt != nil {
		result, err = execWithParams(ctx, stmt, params)
	} else {
		result, err = a.db.ExecContext(ctx, query)
	}
	if err != nil {
		return nil, fmt.Errorf("statement execution failed: %w", err)
	}

	ra, _ := result.RowsAffected()

	return &service.QueryResult{
		Status:       service.JobStatusSuccess,
		RowsAffected: &ra,
	}, nil
}

func queryWithParams(ctx context.Context, stmt *sqlx.Stmt, params any) (*sqlx.Rows, error) {
	switch p := params.(type) {
	case map[string]any:
		return nil, fmt.Errorf("named parameters not yet supported in prepared statements")
	case []any:
		return stmt.QueryxContext(ctx, p...)
	default:
		return stmt.QueryxContext(ctx)
	}
}

func execWithParams(ctx context.Context, stmt *sqlx.Stmt, params any) (sql.Result, error) {
	switch p := params.(type) {
	case map[string]any:
		return nil, fmt.Errorf("named parameters not yet supported in prepared statements")
	case []any:
		return stmt.ExecContext(ctx, p...)
	default:
		return stmt.ExecContext(ctx)
	}
}
