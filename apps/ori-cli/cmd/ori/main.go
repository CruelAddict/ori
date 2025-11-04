package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"syscall"
)

func main() {
	// Parse command-line flags
	configPath := flag.String("config", "", "Path to configuration file (optional)")
	flag.Parse()

	// Auto-discover or create config if not provided
	var absConfigPath string
	if *configPath == "" {
		foundPath, err := findOrCreateConfigFile()
		if err != nil {
			log.Fatalf("Failed to find or create config: %v", err)
		}
		absConfigPath = foundPath
	} else {
		// Use provided config path
		var err error
		absConfigPath, err = filepath.Abs(*configPath)
		if err != nil {
			log.Fatalf("Failed to resolve config path: %v", err)
		}
	}

	// Discover binaries
	bePath, err := findBinary("ori-be")
	if err != nil {
		log.Fatalf("Failed to find ori-be: %v", err)
	}

	tuiPath, err := findBinary("ori-tui")
	if err != nil {
		log.Fatalf("Failed to find ori-tui: %v", err)
	}

	// Create a pipe for parent death monitoring
	// When this process dies, the pipe will close and ori-be will exit
	pipeReader, pipeWriter, err := os.Pipe()
	if err != nil {
		log.Fatalf("Failed to create pipe: %v", err)
	}
	defer pipeWriter.Close()

	// Start the backend
	beCmd := exec.Command(bePath, "-config", absConfigPath)
	beCmd.Stdout = os.Stdout
	beCmd.Stderr = os.Stderr
	// Pass the read end of the pipe as fd 3
	beCmd.ExtraFiles = []*os.File{pipeReader}

	if err := beCmd.Start(); err != nil {
		log.Fatalf("Failed to start backend: %v", err)
	}

	// Close our reference to the read end (child has it now)
	pipeReader.Close()

	// Start the TUI
	tuiCmd := exec.Command(tuiPath, "--server", "localhost:8080")
	tuiCmd.Stdout = os.Stdout
	tuiCmd.Stderr = os.Stderr
	tuiCmd.Stdin = os.Stdin

	if err := tuiCmd.Start(); err != nil {
		beCmd.Process.Kill()
		log.Fatalf("Failed to start TUI: %v", err)
	}

	// Setup signal handling
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

	// Wait for either process to exit or signal
	go func() {
		<-sigChan
		fmt.Println("\nShutting down...")
		tuiCmd.Process.Kill()
		beCmd.Process.Kill()
		os.Exit(0)
	}()

	// Wait for TUI to exit (user closes it)
	tuiCmd.Wait()

	// Clean up backend
	beCmd.Process.Kill()
}

// findBinary looks for a binary in the following order:
// 1. Development build directory (../../<app>/bin/<name>) - for local dev
// 2. Same directory as ori binary - for portable installs
// 3. /usr/local/bin/<name> - for system installs (ori-tui)
// 4. /usr/local/lib/ori/<name> - for system installs (ori-be)
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
	if err := os.MkdirAll(configDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create config directory: %v", err)
	}

	defaultConfig := "connections: []\n"
	if err := os.WriteFile(userConfig, []byte(defaultConfig), 0644); err != nil {
		return "", fmt.Errorf("failed to create config file: %v", err)
	}

	return userConfig, nil
}
