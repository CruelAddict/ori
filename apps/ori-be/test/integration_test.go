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
	duckdbadapter "github.com/crueladdict/ori/apps/ori-server/internal/infrastructure/database/duckdb"
	sqliteadapter "github.com/crueladdict/ori/apps/ori-server/internal/infrastructure/database/sqlite"
	"github.com/crueladdict/ori/apps/ori-server/internal/service"
)

func TestListResourcesAndConnectSQLiteOverUDS(t *testing.T) {
	ctx := context.Background()
	fixtureConfigPath, err := filepath.Abs("../../../testdata/resources.json")
	if err != nil {
		t.Fatalf("Failed to resolve test config path: %v", err)
	}
	fixtureRoot := filepath.Dir(fixtureConfigPath)
	tempRoot := t.TempDir()

	tempConfigPath := filepath.Join(tempRoot, "resources.json")
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

	configService := service.NewResourceCatalogService(tempConfigPath)
	if err := configService.LoadResources(); err != nil {
		t.Fatalf("Failed to load config: %v", err)
	}

	eventHub := events.NewHub()
	connectionService := service.NewResourceSessionService(configService, eventHub)
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

	listResp, err := client.ListResourcesWithResponse(ctx)
	if err != nil {
		t.Fatalf("ListResources failed: %v", err)
	}
	if listResp.JSON200 == nil || len(listResp.JSON200.Resources) == 0 {
		t.Fatalf("expected at least one resource")
	}

	connectReq := dto.ConnectResourceJSONRequestBody{ResourceName: "local-sqlite"}
	var resourceReady bool
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		resp, err := client.ConnectResourceWithResponse(ctx, connectReq)
		if err != nil {
			t.Fatalf("Connect failed: %v", err)
		}
		if resp.JSON201 == nil {
			t.Fatalf("expected 201 payload, got status %d", resp.StatusCode())
		}
		if resp.JSON201.Result == dto.Success {
			resourceReady = true
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if !resourceReady {
		t.Fatalf("resource did not reach success within timeout")
	}

	rootResp, err := client.GetNodesWithResponse(ctx, "local-sqlite", nil)
	if err != nil {
		t.Fatalf("getNodes root failed: %v", err)
	}
	if rootResp.JSON200 == nil || len(rootResp.JSON200.Nodes) == 0 {
		t.Fatalf("expected at least one root node")
	}
	rootNode := mustDatabaseNode(t, rootResp.JSON200.Nodes[0])
	if rootNode.Type != dto.Database {
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
	dbNode := mustDatabaseNode(t, dbResp.JSON200.Nodes[0])
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
	tNode := mustTableNode(t, tableResp.JSON200.Nodes[0])
	if edge, ok := tNode.Edges["columns"]; !ok || len(edge.Items) == 0 {
		t.Fatalf("expected at least one column edge")
	}
	if edge, ok := tNode.Edges["constraints"]; !ok || len(edge.Items) == 0 {
		t.Fatalf("expected at least one constraint edge")
	}
	if edge, ok := tNode.Edges["indexes"]; !ok {
		t.Fatalf("expected indexes edge")
	} else if edge.Items == nil {
		t.Fatalf("expected indexes edge items")
	}
	if edge, ok := tNode.Edges["triggers"]; !ok {
		t.Fatalf("expected triggers edge")
	} else if edge.Items == nil {
		t.Fatalf("expected triggers edge items")
	}
}

func TestQueryExecAndGetResult(t *testing.T) {
	ctx := context.Background()
	fixtureConfigPath, err := filepath.Abs("../../../testdata/resources.json")
	if err != nil {
		t.Fatalf("Failed to resolve test config path: %v", err)
	}
	fixtureRoot := filepath.Dir(fixtureConfigPath)
	tempRoot := t.TempDir()

	tempConfigPath := filepath.Join(tempRoot, "resources.json")
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

	configService := service.NewResourceCatalogService(tempConfigPath)
	if err := configService.LoadResources(); err != nil {
		t.Fatalf("Failed to load config: %v", err)
	}

	eventHub := events.NewHub()
	connectionService := service.NewResourceSessionService(configService, eventHub)
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

	connectReq := dto.ConnectResourceJSONRequestBody{ResourceName: "local-sqlite"}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		resp, err := client.ConnectResourceWithResponse(ctx, connectReq)
		if err != nil {
			t.Fatalf("Connect failed: %v", err)
		}
		if resp.JSON201 != nil && resp.JSON201.Result == dto.Success {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}

	execReq := dto.ExecQueryJSONRequestBody{
		ResourceName: "local-sqlite",
		JobId:        uuid.New(),
		Query:        "SELECT id, name, email FROM authors WHERE id = 1",
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
		ResourceName: "local-sqlite",
		JobId:        uuid.New(),
		Query:        "SELECT id, title FROM books ORDER BY id LIMIT 10",
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
	if paginated.RowCount != 10 {
		t.Fatalf("expected RowCount=10, got %d", paginated.RowCount)
	}

	badResp, err := client.GetQueryResultWithResponse(ctx, "invalid-job-id", nil)
	if err != nil {
		t.Fatalf("QueryGetResult invalid job request failed: %v", err)
	}
	if badResp.StatusCode() != http.StatusNotFound {
		t.Fatalf("expected 404 for invalid job, got %d", badResp.StatusCode())
	}
}

func TestDuckDBIntrospectionAndCSVQuery(t *testing.T) {
	ctx := context.Background()
	fixtureConfigPath, err := filepath.Abs("../../../testdata/resources.json")
	if err != nil {
		t.Fatalf("Failed to resolve test config path: %v", err)
	}
	fixtureRoot := filepath.Dir(fixtureConfigPath)
	tempRoot := t.TempDir()

	tempConfigPath := filepath.Join(tempRoot, "resources.json")
	if err := copyFile(fixtureConfigPath, tempConfigPath); err != nil {
		t.Fatalf("failed to copy config: %v", err)
	}
	tempDuckDBDir := filepath.Join(tempRoot, "duckdb")
	if err := os.MkdirAll(tempDuckDBDir, 0o755); err != nil {
		t.Fatalf("failed to create duckdb dir: %v", err)
	}
	tempDBPath := filepath.Join(tempDuckDBDir, "rich.duckdb")
	srcDBPath := filepath.Join(fixtureRoot, "duckdb", "rich.duckdb")
	if err := copyFile(srcDBPath, tempDBPath); err != nil {
		t.Fatalf("failed to copy duckdb db: %v", err)
	}

	configService := service.NewResourceCatalogService(tempConfigPath)
	if err := configService.LoadResources(); err != nil {
		t.Fatalf("Failed to load config: %v", err)
	}

	eventHub := events.NewHub()
	connectionService := service.NewResourceSessionService(configService, eventHub)
	connectionService.RegisterAdapter("duckdb", duckdbadapter.NewAdapter)
	nodeService := service.NewNodeService(configService, connectionService)
	queryService := service.NewQueryService(connectionService, eventHub, ctx)
	handler := httpapi.NewHandler(configService, connectionService, nodeService, queryService)

	sockPath := unixSocketPath("ori-be-duckdb")
	_ = os.Remove(sockPath)
	srv, err := httpapi.NewUnixServer(ctx, handler, eventHub, sockPath)
	if err != nil {
		t.Fatalf("Failed to create unix server: %v", err)
	}
	t.Cleanup(func() {
		_ = srv.Shutdown()
	})

	client := newContractClient(t, sockPath)

	connectReq := dto.ConnectResourceJSONRequestBody{ResourceName: "local-duckdb"}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		resp, err := client.ConnectResourceWithResponse(ctx, connectReq)
		if err != nil {
			t.Fatalf("Connect failed: %v", err)
		}
		if resp.JSON201 != nil && resp.JSON201.Result == dto.Success {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}

	rootResp, err := client.GetNodesWithResponse(ctx, "local-duckdb", nil)
	if err != nil {
		t.Fatalf("getNodes root failed: %v", err)
	}
	if rootResp.JSON200 == nil || len(rootResp.JSON200.Nodes) == 0 {
		t.Fatalf("expected at least one root node")
	}

	var analyticsSchema dto.SchemaNode
	for _, node := range rootResp.JSON200.Nodes {
		schemaNode := mustSchemaNode(t, node)
		if schemaNode.Name == "analytics" {
			analyticsSchema = schemaNode
			break
		}
	}
	if analyticsSchema.Id == "" {
		t.Fatalf("expected analytics schema root node")
	}
	if analyticsSchema.Attributes.Engine != "duckdb" {
		t.Fatalf("expected duckdb engine, got %q", analyticsSchema.Attributes.Engine)
	}

	schemaIDs := []string{analyticsSchema.Id}
	schemaParams := &dto.GetNodesParams{NodeId: &schemaIDs}
	schemaResp, err := client.GetNodesWithResponse(ctx, "local-duckdb", schemaParams)
	if err != nil {
		t.Fatalf("getNodes schema failed: %v", err)
	}
	if schemaResp.JSON200 == nil || len(schemaResp.JSON200.Nodes) != 1 {
		t.Fatalf("expected single schema node")
	}
	hydratedSchema := mustSchemaNode(t, schemaResp.JSON200.Nodes[0])
	tablesEdge, ok := hydratedSchema.Edges["tables"]
	if !ok || len(tablesEdge.Items) == 0 {
		t.Fatalf("expected tables edge on analytics schema")
	}
	viewsEdge, ok := hydratedSchema.Edges["views"]
	if !ok || len(viewsEdge.Items) == 0 {
		t.Fatalf("expected views edge on analytics schema")
	}

	tableIDs := append([]string(nil), tablesEdge.Items...)
	tableParams := &dto.GetNodesParams{NodeId: &tableIDs}
	tableResp, err := client.GetNodesWithResponse(ctx, "local-duckdb", tableParams)
	if err != nil {
		t.Fatalf("getNodes table failed: %v", err)
	}
	if tableResp.JSON200 == nil || len(tableResp.JSON200.Nodes) == 0 {
		t.Fatalf("expected at least one table node")
	}
	var booksTable dto.TableNode
	var editionsTable dto.TableNode
	for _, node := range tableResp.JSON200.Nodes {
		tableNode := mustTableNode(t, node)
		if tableNode.Name == "books" {
			booksTable = tableNode
		}
		if tableNode.Name == "book_editions" {
			editionsTable = tableNode
		}
	}
	if booksTable.Id == "" {
		t.Fatalf("expected books table node")
	}
	if editionsTable.Id == "" {
		t.Fatalf("expected book_editions table node")
	}
	if booksTable.Name != "books" {
		t.Fatalf("expected books table, got %q", booksTable.Name)
	}
	if edge, ok := booksTable.Edges["columns"]; !ok || len(edge.Items) < 4 {
		t.Fatalf("expected multiple columns on books table")
	}
	if edge, ok := booksTable.Edges["constraints"]; !ok || len(edge.Items) == 0 {
		t.Fatalf("expected constraints on books table")
	}
	if edge, ok := booksTable.Edges["indexes"]; !ok || len(edge.Items) == 0 {
		t.Fatalf("expected indexes on books table")
	}
	if edge, ok := booksTable.Edges["triggers"]; !ok {
		t.Fatalf("expected triggers edge on books table")
	} else if edge.Items == nil {
		t.Fatalf("expected triggers edge items")
	}
	if edge, ok := editionsTable.Edges["indexes"]; !ok || len(edge.Items) == 0 {
		t.Fatalf("expected backing indexes on book_editions table")
	}

	csvPath := filepath.Join(tempRoot, "people.csv")
	csvContent := "id,name\n1,Ada\n2,Grace\n"
	if err := os.WriteFile(csvPath, []byte(csvContent), 0o644); err != nil {
		t.Fatalf("failed to write csv fixture: %v", err)
	}

	execReq := dto.ExecQueryJSONRequestBody{
		ResourceName: "local-duckdb",
		JobId:        uuid.New(),
		Query:        fmt.Sprintf("SELECT id, name FROM read_csv_auto('%s') ORDER BY id", csvPath),
	}
	execResp, err := client.ExecQueryWithResponse(ctx, execReq)
	if err != nil {
		t.Fatalf("DuckDB query exec failed: %v", err)
	}
	if execResp.JSON202 == nil || execResp.JSON202.JobId == "" {
		t.Fatalf("expected job id from DuckDB query exec")
	}

	result := waitForQueryResult(t, ctx, client, execResp.JSON202.JobId, nil, nil)
	if len(result.Columns) != 2 {
		t.Fatalf("expected 2 columns, got %d", len(result.Columns))
	}
	if len(result.Rows) != 2 {
		t.Fatalf("expected 2 rows, got %d", len(result.Rows))
	}
	if got := fmt.Sprint(result.Rows[0][1]); got != "Ada" {
		t.Fatalf("expected first csv row to contain Ada, got %q", got)
	}

	jsonReq := dto.ExecQueryJSONRequestBody{
		ResourceName: "local-duckdb",
		JobId:        uuid.New(),
		Query:        "SELECT profile, rating FROM analytics.authors ORDER BY id LIMIT 1",
	}
	jsonResp, err := client.ExecQueryWithResponse(ctx, jsonReq)
	if err != nil {
		t.Fatalf("DuckDB json query exec failed: %v", err)
	}
	if jsonResp.JSON202 == nil || jsonResp.JSON202.JobId == "" {
		t.Fatalf("expected job id from DuckDB json query exec")
	}

	jsonResult := waitForQueryResult(t, ctx, client, jsonResp.JSON202.JobId, nil, nil)
	if got := fmt.Sprint(jsonResult.Rows[0][0]); got != `{"awards":["Royal Society"]}` {
		t.Fatalf("expected JSON string result, got %q", got)
	}
	if got := fmt.Sprint(jsonResult.Rows[0][1]); got != "9.75" {
		t.Fatalf("expected decimal string result, got %q", got)
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

func mustDatabaseNode(t *testing.T, node dto.Node) dto.DatabaseNode {
	t.Helper()
	discriminator, err := node.Discriminator()
	if err != nil {
		t.Fatalf("failed to read node discriminator: %v", err)
	}
	if discriminator != string(dto.Database) {
		t.Fatalf("expected database node discriminator, got %q", discriminator)
	}
	dbNode, err := node.AsDatabaseNode()
	if err != nil {
		t.Fatalf("failed to decode database node: %v", err)
	}
	return dbNode
}

func mustSchemaNode(t *testing.T, node dto.Node) dto.SchemaNode {
	t.Helper()
	discriminator, err := node.Discriminator()
	if err != nil {
		t.Fatalf("failed to read node discriminator: %v", err)
	}
	if discriminator != string(dto.Schema) {
		t.Fatalf("expected schema node discriminator, got %q", discriminator)
	}
	schemaNode, err := node.AsSchemaNode()
	if err != nil {
		t.Fatalf("failed to decode schema node: %v", err)
	}
	return schemaNode
}

func mustTableNode(t *testing.T, node dto.Node) dto.TableNode {
	t.Helper()
	discriminator, err := node.Discriminator()
	if err != nil {
		t.Fatalf("failed to read node discriminator: %v", err)
	}
	if discriminator != string(dto.Table) {
		t.Fatalf("expected table node discriminator, got %q", discriminator)
	}
	tableNode, err := node.AsTableNode()
	if err != nil {
		t.Fatalf("failed to decode table node: %v", err)
	}
	return tableNode
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
