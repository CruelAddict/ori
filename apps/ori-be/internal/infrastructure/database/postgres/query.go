package postgres

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/sqlutil"
	"github.com/crueladdict/ori/apps/ori-server/internal/service"
)

// ExecuteQuery runs a query and returns the result
func (a *Adapter) ExecuteQuery(ctx context.Context, query string, params any, options *service.QueryExecOptions) (*service.QueryResult, error) {
	if a.db == nil {
		return nil, fmt.Errorf("database not connected")
	}

	// Check if it's a SELECT query or other statement
	if sqlutil.IsSQLSelectQuery(query) {
		return a.executeSelect(ctx, query, params, options)
	}
	return a.executeStatement(ctx, query, params)
}

// executeSelect executes a SELECT query
func (a *Adapter) executeSelect(ctx context.Context, query string, params any, options *service.QueryExecOptions) (*service.QueryResult, error) {
	var rows *sql.Rows
	var err error

	// Execute the query with parameters
	args := toArgs(params)
	if len(args) > 0 {
		rows, err = a.db.QueryContext(ctx, query, args...)
	} else {
		rows, err = a.db.QueryContext(ctx, query)
	}
	if err != nil {
		return nil, fmt.Errorf("query execution failed: %w", err)
	}
	defer rows.Close()

	// Get column information
	columns, err := rows.Columns()
	if err != nil {
		return nil, fmt.Errorf("failed to get columns: %w", err)
	}

	// Get column types
	columnTypes, err := rows.ColumnTypes()
	if err != nil {
		return nil, fmt.Errorf("failed to get column types: %w", err)
	}

	// Build column metadata
	queryColumns := make([]service.QueryColumn, len(columns))
	for i, name := range columns {
		colType := "unknown"
		if i < len(columnTypes) {
			dbType := columnTypes[i].DatabaseTypeName()
			if dbType != "" {
				colType = dbType
			}
		}
		queryColumns[i] = service.QueryColumn{
			Name: name,
			Type: colType,
		}
	}

	// Prepare slice to hold row data
	rowData := make([]any, len(columns))
	rowPtrs := make([]any, len(columns))
	for i := range rowData {
		rowPtrs[i] = &rowData[i]
	}

	var allRows [][]any
	rowCount := 0
	truncated := false

	// Collect rows up to the limit
	for rows.Next() {
		if err := rows.Scan(rowPtrs...); err != nil {
			return nil, fmt.Errorf("failed to scan row: %w", err)
		}

		// Create a copy of the row data
		rowCopy := make([]any, len(rowData))
		for i, val := range rowData {
			rowCopy[i] = val
		}

		allRows = append(allRows, rowCopy)
		rowCount++

		// Check if we've hit the row limit
		if rowCount >= options.MaxRows {
			// Check if there are more rows
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

// executeStatement executes a non-SELECT statement (INSERT, UPDATE, DELETE, etc.)
func (a *Adapter) executeStatement(ctx context.Context, query string, params any) (*service.QueryResult, error) {
	var result sql.Result
	var err error

	// Execute the statement with parameters
	args := toArgs(params)
	if len(args) > 0 {
		result, err = a.db.ExecContext(ctx, query, args...)
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

// toArgs converts params to a slice of arguments for the query
// PostgreSQL uses $1, $2, etc. for parameters, and pgx handles this natively
func toArgs(params any) []any {
	if params == nil {
		return nil
	}
	switch p := params.(type) {
	case []any:
		return p
	case map[string]any:
		// For named parameters, we'd need to rewrite the query
		// For now, return empty - queries should use positional params
		return nil
	default:
		return nil
	}
}
