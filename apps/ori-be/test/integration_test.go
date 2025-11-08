package server_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/crueladdict/ori/apps/ori-server/internal/rpc"
	"github.com/crueladdict/ori/apps/ori-server/internal/service"
	orisdk "github.com/crueladdict/ori/libs/sdk/go"
)

func TestListConfigurationsAndConnectSQLiteOverUDS(t *testing.T) {
	// Setup: Use test config file
	testConfigPath, err := filepath.Abs("../../../testdata/config.yaml")
	if err != nil {
		t.Fatalf("Failed to resolve test config path: %v", err)
	}

	// Ensure sqlite test db directory exists (db may be created by server on open)
	dbDir := filepath.Join(filepath.Dir(testConfigPath), "sqlite")
	_ = os.MkdirAll(dbDir, 0o755)

	configService := service.NewConfigService(testConfigPath)

	// Load config at startup
	if err := configService.LoadConfig(); err != nil {
		t.Fatalf("Failed to load config: %v", err)
	}

	ctx := context.Background()
	connectionService := service.NewConnectionService(configService)
	handler := rpc.NewHandler(configService, connectionService)

	// Start server over Unix domain socket
	sockPath := filepath.Join(os.TempDir(), "ori-be-test.sock")
	_ = os.Remove(sockPath)
	srv, err := rpc.NewUnixServer(ctx, handler, sockPath)
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
	if _, err := os.Stat(filepath.Join(dbDir, "simple.db")); err == nil {
		// clean slate so we can observe connect
		_ = os.Remove(filepath.Join(dbDir, "simple.db"))
	}

	cres, err := client.Connect("local-sqlite")
	if err != nil {
		t.Fatalf("Connect (first) failed: %v", err)
	}
	if cres.Result != "connecting" {
		t.Fatalf("Expected result 'connecting', got '%s'", cres.Result)
	}

	// Wait up to 2s for background connect to succeed
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		cres2, err2 := client.Connect("local-sqlite")
		if err2 != nil {
			t.Fatalf("Connect (second) failed: %v", err2)
		}
		if cres2.Result == "success" {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("Connect did not reach success within timeout")
}
