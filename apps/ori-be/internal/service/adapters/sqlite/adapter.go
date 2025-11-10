package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"strings"
	"unicode"

	_ "modernc.org/sqlite"

	"github.com/crueladdict/ori/apps/ori-server/internal/model"
	"github.com/crueladdict/ori/apps/ori-server/internal/service"
)

// Adapter implements service.ConnectionAdapter for SQLite databases.
type Adapter struct {
	connectionName string
	config         *model.Configuration
	dbPath         string
	db             *sql.DB
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

func (a *Adapter) databaseDisplayName(connectionName, dbName, file string) string {
	if file == "" {
		return fmt.Sprintf("%s (%s)", dbName, connectionName)
	}
	return fmt.Sprintf("%s (%s)", dbName, file)
}

func (a *Adapter) pragmaInt(ctx context.Context, schema, pragma string) (int64, error) {
	query := fmt.Sprintf(`PRAGMA "%s".%s`, escapeIdentifier(schema), pragma)
	var value int64
	err := a.db.QueryRowContext(ctx, query).Scan(&value)
	return value, err
}

func (a *Adapter) pragmaText(ctx context.Context, schema, pragma string) (string, error) {
	query := fmt.Sprintf(`PRAGMA "%s".%s`, escapeIdentifier(schema), pragma)
	var value string
	err := a.db.QueryRowContext(ctx, query).Scan(&value)
	return value, err
}

func copyStrings(src []string) []string {
	if len(src) == 0 {
		return nil
	}
	dst := make([]string, len(src))
	copy(dst, src)
	return dst
}

func slug(parts ...string) string {
	var tokens []string
	for _, part := range parts {
		p := strings.TrimSpace(part)
		if p == "" {
			continue
		}
		var b strings.Builder
		lastDash := false
		for _, r := range strings.ToLower(p) {
			if unicode.IsLetter(r) || unicode.IsDigit(r) {
				b.WriteRune(r)
				lastDash = false
				continue
			}
			if !lastDash {
				b.WriteRune('-')
				lastDash = true
			}
		}
		token := strings.Trim(b.String(), "-")
		if token != "" {
			tokens = append(tokens, token)
		}
	}
	if len(tokens) == 0 {
		return "node"
	}
	return strings.Join(tokens, "-")
}

func escapeIdentifier(input string) string {
	return strings.ReplaceAll(input, "\"", "\"\"")
}

func quoteLiteral(input string) string {
	return fmt.Sprintf("'%s'", strings.ReplaceAll(input, "'", "''"))
}

// isSelectQuery checks if a query is a SELECT statement
func isSelectQuery(query string) bool {
	for i := 0; i < len(query); i++ {
		ch := query[i]
		if ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r' {
			continue
		}
		return len(query) >= i+6 &&
			(query[i] == 's' || query[i] == 'S') &&
			(query[i+1] == 'e' || query[i+1] == 'E') &&
			(query[i+2] == 'l' || query[i+2] == 'L') &&
			(query[i+3] == 'e' || query[i+3] == 'E') &&
			(query[i+4] == 'c' || query[i+4] == 'C') &&
			(query[i+5] == 't' || query[i+5] == 'T')
	}
	return false
}

// queryWithParams executes a query with parameters
func queryWithParams(ctx context.Context, stmt *sql.Stmt, params interface{}) (*sql.Rows, error) {
	switch p := params.(type) {
	case map[string]interface{}:
		// Named parameters - not supported yet for prepared statements
		return nil, fmt.Errorf("named parameters not yet supported in prepared statements")
	case []interface{}:
		// Positional parameters
		return stmt.QueryContext(ctx, p...)
	default:
		// No parameters or unsupported type
		return stmt.QueryContext(ctx)
	}
}

// execWithParams executes a statement with parameters
func execWithParams(ctx context.Context, stmt *sql.Stmt, params interface{}) (sql.Result, error) {
	switch p := params.(type) {
	case map[string]interface{}:
		// Named parameters - not supported yet
		return nil, fmt.Errorf("named parameters not yet supported in prepared statements")
	case []interface{}:
		// Positional parameters
		return stmt.ExecContext(ctx, p...)
	default:
		// No parameters or unsupported type
		return stmt.ExecContext(ctx)
	}
}
