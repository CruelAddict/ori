package sqlite

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/crueladdict/ori/apps/ori-server/internal/service"
)

// ExecuteQuery runs a query and returns the result
func (a *Adapter) ExecuteQuery(ctx context.Context, query string, params interface{}, options *service.QueryExecOptions) (*service.QueryResult, error) {
	if a.db == nil {
		return nil, fmt.Errorf("database not connected")
	}

	// Prepare the query if we have parameters
	var stmt *sql.Stmt
	var err error

	if params != nil {
		stmt, err = a.db.PrepareContext(ctx, query)
		if err != nil {
			return nil, fmt.Errorf("failed to prepare query: %w", err)
		}
		defer stmt.Close()
	}

	// Check if it's a SELECT query or other statement
	isSelect := isSelectQuery(query)

	if isSelect {
		return a.executeSelect(ctx, stmt, query, params, options)
	}
	return a.executeStatement(ctx, stmt, query, params)
}

// executeSelect executes a SELECT query
func (a *Adapter) executeSelect(ctx context.Context, stmt *sql.Stmt, query string, params interface{}, options *service.QueryExecOptions) (*service.QueryResult, error) {
	var rows *sql.Rows
	var err error

	// Execute the query
	if stmt != nil {
		rows, err = queryWithParams(ctx, stmt, params)
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

	// Prepare slice to hold row data
	rowData := make([]interface{}, len(columns))
	rowPtrs := make([]interface{}, len(columns))
	for i := range rowData {
		rowPtrs[i] = &rowData[i]
	}

	var allRows [][]interface{}
	rowCount := 0
	truncated := false

	// Collect rows up to the limit
	for rows.Next() {
		if err := rows.Scan(rowPtrs...); err != nil {
			return nil, fmt.Errorf("failed to scan row: %w", err)
		}

		// Create a copy of the row data
		rowCopy := make([]interface{}, len(rowData))
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
		Columns:   columns,
		Rows:      allRows,
		RowCount:  rowCount,
		Truncated: truncated,
	}, nil
}

// executeStatement executes a non-SELECT statement (INSERT, UPDATE, DELETE, etc.)
func (a *Adapter) executeStatement(ctx context.Context, stmt *sql.Stmt, query string, params interface{}) (*service.QueryResult, error) {
	var result sql.Result
	var err error

	// Execute the statement
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
