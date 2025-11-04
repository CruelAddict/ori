package server_test

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"github.com/crueladdict/ori/apps/ori-server/internal/rpc"
	"github.com/crueladdict/ori/apps/ori-server/internal/service"
	orisdk "github.com/crueladdict/ori/libs/sdk/go"
)

func TestListConfigurations(t *testing.T) {
	// Setup: Use test config file
	testConfigPath, err := filepath.Abs("../../../testdata/config.yaml")
	if err != nil {
		t.Fatalf("Failed to resolve test config path: %v", err)
	}

	// Start server on a test port
	testPort := 18080
	configService := service.NewConfigService(testConfigPath)

	// Load config at startup
	if err := configService.LoadConfig(); err != nil {
		t.Fatalf("Failed to load config: %v", err)
	}

	ctx := context.Background()
	handler := rpc.NewHandler(configService)
	srv, err := rpc.NewServer(ctx, handler, testPort)
	if err != nil {
		t.Fatalf("Failed to create server: %v", err)
	}

	// Give server time to start
	time.Sleep(100 * time.Millisecond)

	// Ensure server cleanup
	defer func() {
		if err := srv.Shutdown(); err != nil {
			t.Logf("Failed to shutdown server: %v", err)
		}
	}()

	// Create client
	client := orisdk.NewClient(fmt.Sprintf("http://localhost:%d/rpc", testPort))

	// Test: Call listConfigurations
	resp, err := client.ListConfigurations()
	if err != nil {
		t.Fatalf("ListConfigurations failed: %v", err)
	}

	// Verify response
	if resp == nil {
		t.Fatal("Response is nil")
	}

	if len(resp.Connections) != 1 {
		t.Fatalf("Expected 1 connection, got %d", len(resp.Connections))
	}

	conn := resp.Connections[0]

	// Verify connection details match test config
	if conn.Name != "test-mysql" {
		t.Errorf("Expected name 'test-mysql', got '%s'", conn.Name)
	}
	if conn.Type != "mysql" {
		t.Errorf("Expected type 'mysql', got '%s'", conn.Type)
	}
	if conn.Host != "localhost" {
		t.Errorf("Expected host 'localhost', got '%s'", conn.Host)
	}
	if conn.Port != 3306 {
		t.Errorf("Expected port 3306, got %d", conn.Port)
	}
	if conn.Database != "testdb" {
		t.Errorf("Expected database 'testdb', got '%s'", conn.Database)
	}
	if conn.Username != "testuser" {
		t.Errorf("Expected username 'testuser', got '%s'", conn.Username)
	}

	// Verify password config
	if conn.Password.Type != "plain_text" {
		t.Errorf("Expected password type 'plain_text', got '%s'", conn.Password.Type)
	}
	if conn.Password.Key != "testpassword123" {
		t.Errorf("Expected password key 'testpassword123', got '%s'", conn.Password.Key)
	}

	t.Log("Test passed: listConfigurations returned expected configuration")
}
