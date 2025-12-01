package main

import (
	"context"
	"flag"
	"fmt"
	"hash/fnv"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

type levelFlag struct {
	val slog.Level
	set bool
}

func (f *levelFlag) String() string { return levelString(f.val) }

func (f *levelFlag) Set(s string) error {
	f.val = parseLevel(s, slog.LevelWarn)
	f.set = true
	return nil
}

func main() {
	configPath := flag.String("config", "", "Path to configuration file (optional)")
	var lf levelFlag
	lf.val = slog.LevelWarn
	flag.Var(&lf, "log-level", "Log level: debug|info|warn|error (propagated to backend and TUI)")
	oriBePath := flag.String("ori-be-path", "", "Path to ori-be binary (optional)")
	oriTuiPath := flag.String("ori-tui-path", "", "Path to ori-tui binary (optional)")
	flag.Parse()

	// Configure CLI logging: only emits to stdout in debug; otherwise silent
	level := lf.val
	if level == slog.LevelDebug {
		h := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level})
		slog.SetDefault(slog.New(h).With(slog.String("app", "ori-cli")))
	} else {
		h := slog.NewJSONHandler(io.Discard, &slog.HandlerOptions{Level: level})
		slog.SetDefault(slog.New(h).With(slog.String("app", "ori-cli")))
	}

	var absConfigPath string
	if *configPath == "" {
		slog.Debug("Finding or creating config file")
		foundPath, err := findOrCreateConfigFile()
		if err != nil {
			dief("Failed to find or create config: %v", err)
		}
		absConfigPath = foundPath
	} else {
		slog.Debug("Resolving config path", "path", *configPath)
		var err error
		absConfigPath, err = filepath.Abs(*configPath)
		if err != nil {
			dief("Failed to resolve config path: %v", err)
		}
	}

	slog.Debug("Finding ori-be binary")
	bePath, err := findBinary("ori-be", *oriBePath)
	if err != nil {
		dief("Failed to find ori-be: %v", err)
	}

	slog.Debug("Finding ori-tui binary")
	tuiPath, err := findBinary("ori-tui", *oriTuiPath)
	if err != nil {
		dief("Failed to find ori-tui: %v", err)
	}

	slog.Debug("Getting runtime directory")
	runDir := runtimeTmpFilesDir()
	slog.Debug("Creating runtime directory", "path", runDir)
	if err := os.MkdirAll(runDir, 0o700); err != nil {
		dief("Failed to create runtime dir: %v", err)
	}
	slog.Debug("Cleaning up stale sockets")
	cleanupStaleSockets(runDir)

	// Backend per config file
	backendID := hashPath(absConfigPath)
	socketPath := filepath.Join(runDir, fmt.Sprintf("ori-%s.sock", backendID))
	slog.Debug("Checking socket health", "socket", socketPath)
	existsAndHealthy := healthcheckUnix(socketPath, 400*time.Millisecond)

	// Create a pipe for parent death monitoring (for ori-be if we start it)
	pipeReader, pipeWriter, err := os.Pipe()
	if err != nil {
		dief("Failed to create pipe: %v", err)
	}
	defer pipeWriter.Close()

	// String log level to pass to children (only if explicitly set)
	effectiveLevel := levelString(level)

	var beCmd *exec.Cmd
	if !existsAndHealthy {
		// Start the backend bound to the computed unix socket
		beArgs := []string{"-config", absConfigPath, "-socket", socketPath}
		if lf.set {
			beArgs = append(beArgs, "-log-level", effectiveLevel)
		}
		beCmd = exec.Command(bePath, beArgs...)
		beCmd.Stdout = os.Stdout
		beCmd.Stderr = os.Stderr
		// Pass the read end of the pipe as fd 3
		beCmd.ExtraFiles = []*os.File{pipeReader}

		slog.Debug("Starting backend process", "path", bePath, "args", beArgs)
		if err := beCmd.Start(); err != nil {
			dief("Failed to start backend: %v", err)
		}
	} else {
		// Not starting backend; close child end of the pipe
		pipeReader.Close()
	}

	// Close our reference to the read end if we started the backend
	if beCmd != nil {
		pipeReader.Close()
	}

	tuiArgs := []string{"--socket", socketPath}
	if lf.set {
		tuiArgs = append(tuiArgs, "--log-level", effectiveLevel)
	}
	tuiCmd := exec.Command(tuiPath, tuiArgs...)
	tuiCmd.Stdout = os.Stdout
	tuiCmd.Stderr = os.Stderr
	tuiCmd.Stdin = os.Stdin

	slog.Debug("Starting TUI process", "path", tuiPath, "args", tuiArgs)
	if err := tuiCmd.Start(); err != nil {
		if beCmd != nil && beCmd.Process != nil {
			_ = beCmd.Process.Kill()
		}
		dief("Failed to start TUI: %v", err)
	}

	// Setup graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

	// Wait for either process to exit or signal
	go func() {
		<-sigChan
		fmt.Println("\nShutting down...")
		_ = tuiCmd.Process.Kill()
		if beCmd != nil {
			_ = beCmd.Process.Kill()
		}
		os.Exit(0)
	}()

	_ = tuiCmd.Wait()
	if beCmd != nil {
		_ = beCmd.Process.Kill()
	}
}

func dief(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}

// healthcheckUnix performs a simple GET /healthcheck over a unix domain socket
func healthcheckUnix(socketPath string, timeout time.Duration) bool {
	slog.Debug("Performing healthcheck", "socket", socketPath, "timeout", timeout)
	tr := &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			return net.Dial("unix", socketPath)
		},
	}
	client := &http.Client{Transport: tr, Timeout: timeout}
	resp, err := client.Get("http://unix/health")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false
	}
	b, _ := io.ReadAll(resp.Body)
	return strings.HasPrefix(string(b), "ok")
}

// cleanupStaleSockets scans the runtime dir for ori-*.sock and removes those that fail healthcheck
func cleanupStaleSockets(runDir string) {
	slog.Debug("Reading runtime directory for cleanup", "path", runDir)
	entries, err := os.ReadDir(runDir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !strings.HasPrefix(name, "ori-") || !strings.HasSuffix(name, ".sock") {
			continue
		}
		path := filepath.Join(runDir, name)
		slog.Debug("Health checking socket", "path", path)
		if !healthcheckUnix(path, 200*time.Millisecond) {
			slog.Debug("Removing stale socket", "path", path)
			_ = os.Remove(path)
		}
	}
}

// runtimeTmpFilesDir returns XDG_RUNTIME_DIR/ori or ~/.cache/ori as fallback
func runtimeTmpFilesDir() string {
	if x := os.Getenv("XDG_RUNTIME_DIR"); x != "" {
		slog.Debug("Using XDG_RUNTIME_DIR", "path", x)
		return filepath.Join(x, "ori")
	}
	slog.Debug("Getting home directory for runtime dir")
	home, err := os.UserHomeDir()
	if err != nil {
		slog.Debug("Failed to get home dir, using temp dir")
		return filepath.Join(os.TempDir(), "ori")
	}
	return filepath.Join(home, ".cache", "ori")
}

func hashPath(s string) string {
	h := fnv.New32a()
	_, _ = h.Write([]byte(s))
	return fmt.Sprintf("%08x", h.Sum32())
}

func findBinary(name string, overridePath string) (string, error) {
	slog.Debug("Finding binary", "name", name, "override", overridePath)

	// If override path is provided, use it
	if overridePath != "" {
		if _, err := os.Stat(overridePath); err == nil {
			return overridePath, nil
		}
		return "", fmt.Errorf("override path %s not found", overridePath)
	}

	// Get directory of current executable
	exePath, err := os.Executable()
	if err != nil {
		return "", err
	}
	exeDir := filepath.Dir(exePath)

	// Check ../libexec/<name> relative to CLI binary
	libexecPath := filepath.Join(exeDir, "..", "libexec", name)
	if absPath, err := filepath.Abs(libexecPath); err == nil {
		if _, err := os.Stat(absPath); err == nil {
			return absPath, nil
		}
	}

	return "", fmt.Errorf("binary %s not found", name)
}

// findOrCreateConfigFile looks for config in the following order:
// 1. .ori-config.yaml in current directory
// 2. ~/.config/ori/config.yaml
// If none exist, creates ~/.config/ori/config.yaml with empty connections
func findOrCreateConfigFile() (string, error) {
	// Check current directory
	cwd, err := os.Getwd()
	if err == nil {
		localConfig := filepath.Join(cwd, ".ori-config.yaml")
		slog.Debug("Checking for local config", "path", localConfig)
		if _, err := os.Stat(localConfig); err == nil {
			return localConfig, nil
		}
	}

	// Check user config directory
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("failed to get home directory: %v", err)
	}

	userConfig := filepath.Join(homeDir, ".config", "ori", "config.yaml")
	slog.Debug("Checking for user config", "path", userConfig)
	if _, err := os.Stat(userConfig); err == nil {
		return userConfig, nil
	}

	// No config found, create default one
	configDir := filepath.Join(homeDir, ".config", "ori")
	slog.Debug("Creating config directory", "path", configDir)
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		return "", fmt.Errorf("failed to create config directory: %v", err)
	}

	defaultConfig := "connections: []\n"
	slog.Debug("Creating default config file", "path", userConfig)
	if err := os.WriteFile(userConfig, []byte(defaultConfig), 0o644); err != nil {
		return "", fmt.Errorf("failed to create config file: %v", err)
	}

	return userConfig, nil
}

func parseLevel(s string, def slog.Level) slog.Level {
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

func levelString(l slog.Level) string {
	switch l {
	case slog.LevelDebug:
		return "debug"
	case slog.LevelInfo:
		return "info"
	case slog.LevelWarn:
		return "warn"
	case slog.LevelError:
		return "error"
	default:
		return "info"
	}
}
