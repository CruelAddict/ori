package main

import (
	"context"
	"flag"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/crueladdict/ori/apps/ori-server/internal/rpc"
	"github.com/crueladdict/ori/apps/ori-server/internal/service"
)

const (
	DefaultConfigPath = "./config.yaml"
	DefaultPort       = 8080
)

func main() {
	// Parse command-line flags
	configPath := flag.String("config", DefaultConfigPath, "Path to configuration file")
	port := flag.Int("port", DefaultPort, "Port to listen on (TCP, optional)")
	socketPath := flag.String("socket", "", "Unix domain socket path (preferred)")
	flag.Parse()

	// Set up parent death monitoring via pipe (file descriptor 3)
	// If parent process dies, the pipe will close and we exit
	go monitorParentAlive()

	// Create context for server lifecycle
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Initialize service
	configService := service.NewConfigService(*configPath)

	// Load configuration at startup
	log.Printf("Loading configuration from: %s", *configPath)
	if err := configService.LoadConfig(); err != nil {
		log.Printf("Warning: Failed to load configuration: %v", err)
		log.Println("Starting with empty configuration")
	} else {
		log.Println("Configuration loaded successfully")
	}

	// Initialize RPC handler and server
	handler := rpc.NewHandler(configService)

	var (
		server *rpc.Server
		err    error
	)
	if *socketPath != "" {
		server, err = rpc.NewUnixServer(ctx, handler, *socketPath)
		if err != nil {
			log.Fatalf("Failed to create unix socket server: %v", err)
		}
		log.Printf("JSON-RPC server started on unix socket %s", *socketPath)
	} else {
		server, err = rpc.NewServer(ctx, handler, *port)
		if err != nil {
			log.Fatalf("Failed to create TCP server: %v", err)
		}
		log.Printf("JSON-RPC server started on port %d", *port)
	}

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")

	// Graceful shutdown
	if err := server.Shutdown(); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}

	// Cancel context to stop server
	cancel()

	// Wait for server to finish
	if err := server.Wait(); err != nil {
		log.Printf("Server wait error: %v", err)
	}

	log.Println("Server stopped")
}

// monitorParentAlive monitors if the parent process is still alive
// by reading from file descriptor 3 (a pipe passed by the parent).
// When the parent dies, the pipe closes and this function exits the process.
func monitorParentAlive() {
	// File descriptor 3 is the read end of a pipe from parent
	// (fd 0=stdin, 1=stdout, 2=stderr, 3=parent pipe)
	pipe := os.NewFile(3, "parent-pipe")
	if pipe == nil {
		// No pipe provided, running standalone (not from ori-cli)
		return
	}
	defer pipe.Close()

	// Block reading from pipe. When parent dies, pipe closes and read returns EOF
	buf := make([]byte, 1)
	_, err := pipe.Read(buf)

	if err != nil {
		// Parent died (pipe closed), exit immediately
		log.Println("Parent process died, exiting...")
		os.Exit(0)
	}
}
