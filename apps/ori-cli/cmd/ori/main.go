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
		foundPath, err := findOrCreateConfigFile()
		if err != nil {
			dief("Failed to find or create config: %v", err)
		}
		absConfigPath = foundPath
	} else {
		var err error
		absConfigPath, err = filepath.Abs(*configPath)
		if err != nil {
			dief("Failed to resolve config path: %v", err)
		}
	}

	bePath, err := findBinary("ori-be")
	if err != nil {
		dief("Failed to find ori-be: %v", err)
	}

	tuiPath, err := findBinary("ori-tui")
	if err != nil {
		dief("Failed to find ori-tui: %v", err)
	}

	runDir := runtimeTmpFilesDir()
	if err := os.MkdirAll(runDir, 0o700); err != nil {
		dief("Failed to create runtime dir: %v", err)
	}
	cleanupStaleSockets(runDir)

	// Backend per config file
	backendID := hashPath(absConfigPath)
	socketPath := filepath.Join(runDir, fmt.Sprintf("ori-%s.sock", backendID))
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
	tr := &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			return net.Dial("unix", socketPath)
		},
	}
	client := &http.Client{Transport: tr, Timeout: timeout}
	resp, err := client.Get("http://unix/healthcheck")
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
		if !healthcheckUnix(path, 200*time.Millisecond) {
			_ = os.Remove(path)
		}
	}
}

// runtimeTmpFilesDir returns XDG_RUNTIME_DIR/ori or ~/.cache/ori as fallback
func runtimeTmpFilesDir() string {
	if x := os.Getenv("XDG_RUNTIME_DIR"); x != "" {
		return filepath.Join(x, "ori")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(os.TempDir(), "ori")
	}
	return filepath.Join(home, ".cache", "ori")
}

func hashPath(s string) string {
	h := fnv.New32a()
	_, _ = h.Write([]byte(s))
	return fmt.Sprintf("%08x", h.Sum32())
}

// findBinary looks for a binary in the following order:
// 1. Development build directory (../../<app>/bin/<name>) - for local dev
// 2. Same directory as ori binary - for portable installs
// 3. /usr/local/bin/<name> - for system installs (ori-tui)
// 4. /usr/local/lib/ori/<name> - for system installs (ori-be)
// I know it's a shitshow
func findBinary(name string) (string, error) {
	// Get directory of current executable
	exePath, err := os.Executable()
	if err != nil {
		return "", err
	}
	exeDir := filepath.Dir(exePath)

	// Determine the app directory name from the binary name
	appDir := name
	if name == "ori-be" {
		appDir = "ori-be"
	} else if name == "ori-tui" {
		appDir = "ori-tui"
	}

	// Check development build directory FIRST
	devPath := filepath.Join(exeDir, "..", "..", appDir, "bin", name)
	if absPath, err := filepath.Abs(devPath); err == nil {
		if _, err := os.Stat(absPath); err == nil {
			return absPath, nil
		}
	}

	// Check same directory
	path := filepath.Join(exeDir, name)
	if _, err := os.Stat(path); err == nil {
		return path, nil
	}

	// Check /usr/local/bin for ori-tui
	if name == "ori-tui" {
		binPath := filepath.Join("/usr/local/bin", name)
		if _, err := os.Stat(binPath); err == nil {
			return binPath, nil
		}
	}

	// Check standard installation path in /usr/local/lib/ori
	installPath := filepath.Join("/usr/local/lib/ori", name)
	if _, err := os.Stat(installPath); err == nil {
		return installPath, nil
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
	if _, err := os.Stat(userConfig); err == nil {
		return userConfig, nil
	}

	// No config found, create default one
	configDir := filepath.Join(homeDir, ".config", "ori")
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		return "", fmt.Errorf("failed to create config directory: %v", err)
	}

	defaultConfig := "connections: []\n"
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
