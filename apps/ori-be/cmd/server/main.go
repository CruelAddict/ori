package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"

	"github.com/crueladdict/ori/apps/ori-server/internal/events"
	postgresadapter "github.com/crueladdict/ori/apps/ori-server/internal/infrastructure/database/postgres"
	sqliteadapter "github.com/crueladdict/ori/apps/ori-server/internal/infrastructure/database/sqlite"
	"github.com/crueladdict/ori/apps/ori-server/internal/rpc"
	"github.com/crueladdict/ori/apps/ori-server/internal/service"
)

const (
	DefaultConfigPath = "./config.yaml"
	DefaultPort       = 8080
)

var (
	currentLogFile  *os.File
	currentLogPath  string
	currentLogLevel slog.Leveler
	currentApp      string
)

func main() {
	// Parse command-line flags
	configPath := flag.String("config", DefaultConfigPath, "Path to configuration file")
	port := flag.Int("port", DefaultPort, "Port to listen on (TCP, optional)")
	socketPath := flag.String("socket", "", "Unix domain socket path (preferred)")
	logLevelFlag := flag.String("log-level", "info", "Log level: debug|info|warn|error")
	standalone := flag.Bool("standalone", false, "Run without parent-process monitoring (foreground mode)")
	flag.Parse()

	level := parseLevel(*logLevelFlag, slog.LevelInfo)
	logger := newFileLogger("ori-be", level)
	slog.SetDefault(logger)

	// Handle SIGHUP to reopen log file after external rotation
	hup := make(chan os.Signal, 1)
	signal.Notify(hup, syscall.SIGHUP)
	go func() {
		for range hup {
			if currentLogFile != nil {
				_ = currentLogFile.Close()
			}
			newLogger := newFileLogger(currentApp, currentLogLevel)
			slog.SetDefault(newLogger)
			slog.Info("log file reopened", slog.String("path", currentLogPath))
		}
	}()

	// Set up parent death monitoring via pipe (file descriptor 3)
	// If parent process dies, the pipe will close and we exit
	if !*standalone {
		go monitorParentAlive()
	} else {
		slog.Info("standalone mode: parent monitor disabled")
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	configService := service.NewConfigService(*configPath)

	slog.Info("loading configuration", slog.String("path", *configPath))
	if err := configService.LoadConfig(); err != nil {
		slog.Error("failed to load configuration", slog.Any("err", err))
		os.Exit(1)
	} else {
		slog.Info("configuration loaded")
	}

	eventHub := events.NewHub()
	connectionService := service.NewConnectionService(configService, eventHub)
	connectionService.RegisterAdapter("sqlite", sqliteadapter.NewAdapter)
	connectionService.RegisterAdapter("postgresql", postgresadapter.NewAdapter)
	connectionService.RegisterAdapter("postgres", postgresadapter.NewAdapter)

	nodeService := service.NewNodeService(configService, connectionService)
	queryService := service.NewQueryService(connectionService, eventHub, ctx)

	handler := rpc.NewHandler(configService, connectionService, nodeService, queryService)

	var (
		server *rpc.Server
		err    error
	)
	if *socketPath != "" {
		server, err = rpc.NewUnixServer(ctx, handler, eventHub, *socketPath)
		if err != nil {
			slog.Error("failed to create unix socket server", slog.Any("err", err))
			os.Exit(1)
		}
		slog.Info("server started", slog.String("transport", "unix"), slog.String("socket", *socketPath))
	} else {
		server, err = rpc.NewServer(ctx, handler, eventHub, *port)
		if err != nil {
			slog.Error("failed to create TCP server", slog.Any("err", err))
			os.Exit(1)
		}
		slog.Info("server started", slog.String("transport", "tcp"), slog.Int("port", *port))
	}

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	slog.Info("shutting down")

	// Stop query service to cancel running jobs
	queryService.Stop()

	if err := server.Shutdown(); err != nil {
		slog.Error("server forced to shutdown", slog.Any("err", err))
		os.Exit(1)
	}

	cancel()
	if err := server.Wait(); err != nil {
		slog.Warn("server wait error", slog.Any("err", err))
	}

	slog.Info("server stopped")
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
		slog.Warn("parent process died, exiting")
		os.Exit(0)
	}
}

func newFileLogger(app string, level slog.Leveler) *slog.Logger {
	logDir := defaultLogDir()
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		// If we cannot create the directory, fallback to stderr so we don't lose logs
		h := slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: level})
		return slog.New(h).With(slog.String("app", app))
	}
	filePath := filepath.Join(logDir, fmt.Sprintf("%s.log", app))
	f, err := os.OpenFile(filePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		// Fallback to stderr if file cannot be opened
		h := slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: level})
		return slog.New(h).With(slog.String("app", app))
	}
	currentLogFile = f
	currentLogPath = filePath
	currentLogLevel = level
	currentApp = app

	h := slog.NewJSONHandler(f, &slog.HandlerOptions{Level: level})
	return slog.New(h).With(slog.String("app", app))
}

func parseLevel(s string, def slog.Level) slog.Leveler {
	switch s {
	case "debug":
		return slog.LevelDebug
	case "info":
		return slog.LevelInfo
	case "warn", "warning":
		return slog.LevelWarn
	case "error", "err":
		return slog.LevelError
	default:
		return def
	}
}

func defaultLogDir() string {
	if x := os.Getenv("XDG_STATE_HOME"); x != "" {
		return filepath.Join(x, "ori")
	}
	home, _ := os.UserHomeDir()
	if runtime.GOOS == "darwin" {
		if home != "" {
			return filepath.Join(home, "Library", "Logs", "ori")
		}
	}
	if home != "" {
		return filepath.Join(home, ".local", "state", "ori")
	}
	return filepath.Join(os.TempDir(), "ori")
}
