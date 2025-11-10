package server_test

import (
	"context"
	"database/sql"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/crueladdict/ori/apps/ori-server/internal/events"
	"github.com/crueladdict/ori/apps/ori-server/internal/rpc"
	"github.com/crueladdict/ori/apps/ori-server/internal/service"
	sqliteadapter "github.com/crueladdict/ori/apps/ori-server/internal/service/adapters/sqlite"
	orisdk "github.com/crueladdict/ori/libs/sdk/go"
)

func TestListConfigurationsAndConnectSQLiteOverUDS(t *testing.T) {
	// Setup: Use a temp copy of the fixtures so tests don't mutate the repo files
	fixtureConfigPath, err := filepath.Abs("../../../testdata/config.yaml")
	if err != nil {
		t.Fatalf("Failed to resolve test config path: %v", err)
	}
	fixtureRoot := filepath.Dir(fixtureConfigPath)
	tempRoot := t.TempDir()

	tempConfigPath := filepath.Join(tempRoot, "config.yaml")
	if err := copyFile(fixtureConfigPath, tempConfigPath); err != nil {
		t.Fatalf("failed to copy config: %v", err)
	}
	tempSQLiteDir := filepath.Join(tempRoot, "sqlite")
	if err := os.MkdirAll(tempSQLiteDir, 0o755); err != nil {
		t.Fatalf("failed to create sqlite dir: %v", err)
	}
	tempDBPath := filepath.Join(tempSQLiteDir, "simple.db")
	srcDBPath := filepath.Join(fixtureRoot, "sqlite", "simple.db")
	if err := copyFile(srcDBPath, tempDBPath); err != nil {
		t.Fatalf("failed to copy sqlite db: %v", err)
	}
	ensureSampleData(t, tempDBPath)

	configService := service.NewConfigService(tempConfigPath)

	// Load config at startup
	if err := configService.LoadConfig(); err != nil {
		t.Fatalf("Failed to load config: %v", err)
	}

	ctx := context.Background()
	eventHub := events.NewHub()
	connectionService := service.NewConnectionService(configService, eventHub)
	connectionService.RegisterAdapter("sqlite", sqliteadapter.NewAdapter)
	nodeService := service.NewNodeService(configService, connectionService)
	queryService := service.NewQueryService(connectionService, eventHub, ctx)
	handler := rpc.NewHandler(configService, connectionService, nodeService, queryService)

	// Start server over Unix domain socket
	sockPath := filepath.Join(os.TempDir(), "ori-be-test.sock")
	_ = os.Remove(sockPath)
	srv, err := rpc.NewUnixServer(ctx, handler, eventHub, sockPath)
	if err != nil {
		t.Fatalf("Failed to create unix server: %v", err)
	}
	defer func() {
		_ = srv.Shutdown()
	}()

	// Give server time to start
	time.Sleep(100 * time.Millisecond)

	// Client over UDS
	client := orisdk.NewClientUnix(sockPath)

	// listConfigurations should work over UDS
	resp, err := client.ListConfigurations()
	if err != nil {
		t.Fatalf("ListConfigurations failed: %v", err)
	}
	if resp == nil {
		t.Fatal("Response is nil")
	}
	if len(resp.Connections) == 0 {
		t.Fatalf("Expected at least 1 connection, got 0")
	}

	// Connect to sqlite entry, first call should be connecting
	cres, err := client.Connect("local-sqlite")
	if err != nil {
		t.Fatalf("Connect (first) failed: %v", err)
	}
	if cres.Result != "connecting" {
		t.Fatalf("Expected result 'connecting', got '%s'", cres.Result)
	}

	// Wait up to 2s for background connect to succeed
	deadline := time.Now().Add(2 * time.Second)
	connected := false
	for time.Now().Before(deadline) {
		cres2, err2 := client.Connect("local-sqlite")
		if err2 != nil {
			t.Fatalf("Connect (second) failed: %v", err2)
		}
		if cres2.Result == "success" {
			connected = true
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if !connected {
		t.Fatalf("Connect did not reach success within timeout")
	}

	nodesResp, err := client.GetNodes("local-sqlite")
	if err != nil {
		t.Fatalf("getNodes (root) failed: %v", err)
	}
	if len(nodesResp.Nodes) == 0 {
		t.Fatalf("expected at least one root node")
	}
	rootNode := nodesResp.Nodes[0]
	if rootNode.Type != "database" {
		t.Fatalf("expected database node, got %s", rootNode.Type)
	}
	tablesAtRoot, ok := rootNode.Edges["tables"]
	if !ok || len(tablesAtRoot.Items) == 0 {
		t.Fatalf("expected hydrated root node with tables edge")
	}

	dbResp, err := client.GetNodes("local-sqlite", rootNode.ID)
	if err != nil {
		t.Fatalf("getNodes (database) failed: %v", err)
	}
	if len(dbResp.Nodes) != 1 {
		t.Fatalf("expected 1 node, got %d", len(dbResp.Nodes))
	}
	dbNode := dbResp.Nodes[0]
	tablesEdge, ok := dbNode.Edges["tables"]
	if !ok || len(tablesEdge.Items) == 0 {
		t.Fatalf("expected tables edge with entries")
	}
	tableID := tablesEdge.Items[0]

	tableResp, err := client.GetNodes("local-sqlite", tableID)
	if err != nil {
		t.Fatalf("getNodes (table) failed: %v", err)
	}
	if len(tableResp.Nodes) != 1 {
		t.Fatalf("expected 1 table node, got %d", len(tableResp.Nodes))
	}
	tableNode := tableResp.Nodes[0]
	columnsEdge, ok := tableNode.Edges["columns"]
	if !ok || len(columnsEdge.Items) == 0 {
		t.Fatalf("expected at least one column edge")
	}
	constraintsEdge, ok := tableNode.Edges["constraints"]
	if !ok || len(constraintsEdge.Items) == 0 {
		t.Fatalf("expected at least one constraint edge")
	}
}

func ensureSampleData(t *testing.T, dbPath string) {
	t.Helper()
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("failed to open sqlite db: %v", err)
	}
	defer db.Close()

	statements := []string{
		`CREATE TABLE IF NOT EXISTS authors (
			id INTEGER PRIMARY KEY,
			name TEXT NOT NULL,
			email TEXT UNIQUE
		)`,
		`CREATE TABLE IF NOT EXISTS books (
			id INTEGER PRIMARY KEY,
			author_id INTEGER NOT NULL,
			title TEXT NOT NULL,
			isbn TEXT UNIQUE,
			FOREIGN KEY(author_id) REFERENCES authors(id)
		)`,
		`INSERT OR IGNORE INTO authors (id, name, email) VALUES (1, 'Ada Lovelace', 'ada@example.com')`,
		`INSERT OR IGNORE INTO books (id, author_id, title, isbn) VALUES (1, 1, 'Analytical Sketches', 'ISBN-1')`,
	}
	for _, stmt := range statements {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatalf("failed to prime sqlite db: %v", err)
		}
	}
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Close()
}
