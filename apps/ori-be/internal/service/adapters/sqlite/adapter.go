package sqlite

import (
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
