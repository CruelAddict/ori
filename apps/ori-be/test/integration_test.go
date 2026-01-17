package server_test

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	dto "github.com/crueladdict/ori/libs/contract/go"
	"github.com/google/uuid"

	"github.com/crueladdict/ori/apps/ori-server/internal/events"
	httpapi "github.com/crueladdict/ori/apps/ori-server/internal/httpapi"
	sqliteadapter "github.com/crueladdict/ori/apps/ori-server/internal/infrastructure/database/sqlite"
	"github.com/crueladdict/ori/apps/ori-server/internal/service"
)

func TestListConfigurationsAndConnectSQLiteOverUDS(t *testing.T) {
	ctx := context.Background()
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
	if err := configService.LoadConfig(); err != nil {
		t.Fatalf("Failed to load config: %v", err)
	}

	eventHub := events.NewHub()
	connectionService := service.NewConnectionService(configService, eventHub)
	connectionService.RegisterAdapter("sqlite", sqliteadapter.NewAdapter)
	nodeService := service.NewNodeService(configService, connectionService)
	queryService := service.NewQueryService(connectionService, eventHub, ctx)
	handler := httpapi.NewHandler(configService, connectionService, nodeService, queryService)

	sockPath := unixSocketPath("ori-be")
	_ = os.Remove(sockPath)
	srv, err := httpapi.NewUnixServer(ctx, handler, eventHub, sockPath)
	if err != nil {
		t.Fatalf("Failed to create unix server: %v", err)
	}
	t.Cleanup(func() {
		_ = srv.Shutdown()
	})

	client := newContractClient(t, sockPath)

	listResp, err := client.ListConfigurationsWithResponse(ctx)
	if err != nil {
		t.Fatalf("ListConfigurations failed: %v", err)
	}
	if listResp.JSON200 == nil || len(listResp.JSON200.Connections) == 0 {
		t.Fatalf("expected at least one configuration")
	}

	connectReq := dto.StartConnectionJSONRequestBody{ConfigurationName: "local-sqlite"}
	var connectionReady bool
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		resp, err := client.StartConnectionWithResponse(ctx, connectReq)
		if err != nil {
			t.Fatalf("Connect failed: %v", err)
		}
		if resp.JSON201 == nil {
			t.Fatalf("expected 201 payload, got status %d", resp.StatusCode())
		}
		if resp.JSON201.Result == dto.Success {
			connectionReady = true
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if !connectionReady {
		t.Fatalf("connection did not reach success within timeout")
	}

	rootResp, err := client.GetNodesWithResponse(ctx, "local-sqlite", nil)
	if err != nil {
		t.Fatalf("getNodes root failed: %v", err)
	}
	if rootResp.JSON200 == nil || len(rootResp.JSON200.Nodes) == 0 {
		t.Fatalf("expected at least one root node")
	}
	rootNode := rootResp.JSON200.Nodes[0]
	if rootNode.Type != "database" {
		t.Fatalf("expected database node, got %s", rootNode.Type)
	}
	tablesEdge, ok := rootNode.Edges["tables"]
	if !ok || len(tablesEdge.Items) == 0 {
		t.Fatalf("expected tables edge on root node")
	}

	dbIDs := []string{rootNode.Id}
	dbParams := &dto.GetNodesParams{NodeId: &dbIDs}
	dbResp, err := client.GetNodesWithResponse(ctx, "local-sqlite", dbParams)
	if err != nil {
		t.Fatalf("getNodes database failed: %v", err)
	}
	if dbResp.JSON200 == nil || len(dbResp.JSON200.Nodes) != 1 {
		t.Fatalf("expected single database node")
	}
	dbNode := dbResp.JSON200.Nodes[0]
	tablesAtDB, ok := dbNode.Edges["tables"]
	if !ok || len(tablesAtDB.Items) == 0 {
		t.Fatalf("expected tables edge at database node")
	}
	tableID := tablesAtDB.Items[0]

	tableIDs := []string{tableID}
	tableParams := &dto.GetNodesParams{NodeId: &tableIDs}
	tableResp, err := client.GetNodesWithResponse(ctx, "local-sqlite", tableParams)
	if err != nil {
		t.Fatalf("getNodes table failed: %v", err)
	}
	if tableResp.JSON200 == nil || len(tableResp.JSON200.Nodes) != 1 {
		t.Fatalf("expected single table node")
	}
	tNode := tableResp.JSON200.Nodes[0]
	if edge, ok := tNode.Edges["columns"]; !ok || len(edge.Items) == 0 {
		t.Fatalf("expected at least one column edge")
	}
	if edge, ok := tNode.Edges["constraints"]; !ok || len(edge.Items) == 0 {
		t.Fatalf("expected at least one constraint edge")
	}
}

func TestQueryExecAndGetResult(t *testing.T) {
	ctx := context.Background()
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
	if err := configService.LoadConfig(); err != nil {
		t.Fatalf("Failed to load config: %v", err)
	}

	eventHub := events.NewHub()
	connectionService := service.NewConnectionService(configService, eventHub)
	connectionService.RegisterAdapter("sqlite", sqliteadapter.NewAdapter)
	nodeService := service.NewNodeService(configService, connectionService)
	queryService := service.NewQueryService(connectionService, eventHub, ctx)
	handler := httpapi.NewHandler(configService, connectionService, nodeService, queryService)

	sockPath := unixSocketPath("ori-be-query")
	_ = os.Remove(sockPath)
	srv, err := httpapi.NewUnixServer(ctx, handler, eventHub, sockPath)
	if err != nil {
		t.Fatalf("Failed to create unix server: %v", err)
	}
	t.Cleanup(func() {
		_ = srv.Shutdown()
	})

	client := newContractClient(t, sockPath)

	connectReq := dto.StartConnectionJSONRequestBody{ConfigurationName: "local-sqlite"}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		resp, err := client.StartConnectionWithResponse(ctx, connectReq)
		if err != nil {
			t.Fatalf("Connect failed: %v", err)
		}
		if resp.JSON201 != nil && resp.JSON201.Result == dto.Success {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}

	execReq := dto.ExecQueryJSONRequestBody{
		ConfigurationName: "local-sqlite",
		JobId:             uuid.New(),
		Query:             "SELECT id, name, email FROM authors",
	}
	requestCtx, cancel := context.WithCancel(ctx)
	execResp, err := client.ExecQueryWithResponse(requestCtx, execReq)
	cancel()
	if err != nil {
		t.Fatalf("QueryExec failed: %v", err)
	}
	if execResp.JSON202 == nil || execResp.JSON202.JobId == "" {
		t.Fatalf("expected job id from QueryExec")
	}
	jobID := execResp.JSON202.JobId

	result := waitForQueryResult(t, ctx, client, jobID, nil, nil)
	if len(result.Columns) != 3 {
		t.Fatalf("expected 3 columns, got %d", len(result.Columns))
	}
	if len(result.Rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(result.Rows))
	}

	execReq2 := dto.ExecQueryJSONRequestBody{
		ConfigurationName: "local-sqlite",
		JobId:             uuid.New(),
		Query:             "SELECT id, title FROM books",
	}
	execResp2, err := client.ExecQueryWithResponse(ctx, execReq2)
	if err != nil {
		t.Fatalf("QueryExec (books) failed: %v", err)
	}
	if execResp2.JSON202 == nil {
		t.Fatalf("expected job id for second query")
	}
	limit := 1
	offset := 0
	paginated := waitForQueryResult(t, ctx, client, execResp2.JSON202.JobId, &limit, &offset)
	if len(paginated.Rows) != 1 {
		t.Fatalf("expected 1 row for paginated request")
	}
	if paginated.RowCount != 1 {
		t.Fatalf("expected RowCount=1, got %d", paginated.RowCount)
	}

	badResp, err := client.GetQueryResultWithResponse(ctx, "invalid-job-id", nil)
	if err != nil {
		t.Fatalf("QueryGetResult invalid job request failed: %v", err)
	}
	if badResp.StatusCode() != http.StatusNotFound {
		t.Fatalf("expected 404 for invalid job, got %d", badResp.StatusCode())
	}
}

func waitForQueryResult(t *testing.T, ctx context.Context, client *dto.ClientWithResponses, jobID string, limit, offset *int) *dto.QueryResultResponse {
	t.Helper()
	dl := time.Now().Add(5 * time.Second)
	params := &dto.GetQueryResultParams{Limit: limit, Offset: offset}
	for time.Now().Before(dl) {
		resp, err := client.GetQueryResultWithResponse(ctx, jobID, params)
		if err != nil {
			t.Fatalf("QueryGetResult failed: %v", err)
		}
		if resp.JSON200 != nil {
			return resp.JSON200
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("query %s did not complete within timeout", jobID)
	return nil
}

func newContractClient(t *testing.T, socketPath string) *dto.ClientWithResponses {
	t.Helper()
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return net.Dial("unix", socketPath)
		},
	}
	httpClient := &http.Client{Transport: transport}
	client, err := dto.NewClientWithResponses("http://unix", dto.WithHTTPClient(httpClient))
	if err != nil {
		t.Fatalf("failed to construct contract client: %v", err)
	}
	return client
}

func unixSocketPath(prefix string) string {
	return filepath.Join(os.TempDir(), fmt.Sprintf("%s-%d.sock", prefix, time.Now().UnixNano()))
}

func ensureSampleData(t *testing.T, dbPath string) {
	t.Helper()
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("failed to open sqlite db: %v", err)
	}
	defer func() {
		_ = db.Close()
	}()

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
	defer func() {
		_ = in.Close()
	}()

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer func() {
		_ = out.Close()
	}()

	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Close()
}
