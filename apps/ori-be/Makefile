.PHONY: build test clean run fmt lint help

# Default target
.DEFAULT_GOAL := help

# Binary output directory
BIN_DIR := bin
BINARY_NAME := ori-be

# Go parameters
GOCMD := go
GOBUILD := $(GOCMD) build
GOTEST := $(GOCMD) test
GOCLEAN := $(GOCMD) clean
GOMOD := $(GOCMD) mod

# Build the binary
build: ## Build the ori-be binary
	@echo "Building $(BINARY_NAME)..."
	@mkdir -p $(BIN_DIR)
	@$(GOBUILD) -o $(BIN_DIR)/$(BINARY_NAME) ./cmd/server
	@echo "Build complete: $(BIN_DIR)/$(BINARY_NAME)"

# Run tests
test: ## Run all tests (unit and integration)
	@echo "Running tests..."
	@$(GOTEST) -v ./...
	@echo "Tests complete"

# Clean build artifacts
clean: ## Remove build artifacts and clean Go cache
	@echo "Cleaning..."
	@rm -rf $(BIN_DIR)
	@$(GOCLEAN)
	@echo "Clean complete"

# Build and run the server
run: build ## Build and run the server with default config
	@echo "Starting server..."
	@./$(BIN_DIR)/$(BINARY_NAME) -config ./resources.json

# Download and tidy dependencies
deps: ## Download and tidy Go dependencies
	@echo "Downloading dependencies..."
	@$(GOMOD) download
	@$(GOMOD) tidy
	@echo "Dependencies updated"

# Format code
fmt: ## Format code with gofumpt and goimports
	@command -v gofumpt >/dev/null || { echo "gofumpt not installed; run 'go install mvdan.cc/gofumpt@latest'"; exit 1; }
	@command -v goimports >/dev/null || { echo "goimports not installed; run 'go install golang.org/x/tools/cmd/goimports@latest'"; exit 1; }
	@echo "Formatting with gofumpt..."
	@gofumpt -w .
	@echo "Sorting imports with goimports..."
	@goimports -w .

# Lint and verify formatting/imports
lint: ## Run format/import checks, go mod tidy check, and golangci-lint
	@command -v gofumpt >/dev/null || { echo "gofumpt not installed; run 'go install mvdan.cc/gofumpt@latest'"; exit 1; }
	@command -v goimports >/dev/null || { echo "goimports not installed; run 'go install golang.org/x/tools/cmd/goimports@latest'"; exit 1; }
	@command -v golangci-lint >/dev/null || { echo "golangci-lint not installed; run 'go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest'"; exit 1; }
	@echo "Checking gofumpt formatting..."
	@files=$$(gofumpt -l .); if [ -n "$$files" ]; then echo "formatting is not gofumpt compliant:"; echo "$$files"; exit 1; fi
	@echo "Checking goimports sorting..."
	@imports=$$(goimports -l .); if [ -n "$$imports" ]; then echo "sort imports with goimports:"; echo "$$imports"; exit 1; fi
	@echo "Checking go.mod/go.sum tidiness..."
	@tmpdir=$$(mktemp -d); \
	 rsync -a --exclude '.git' --exclude 'bin' ./ $$tmpdir/ >/dev/null 2>&1; \
	 (cd $$tmpdir && $(GOMOD) tidy >/dev/null 2>&1); \
	 diff -u go.mod $$tmpdir/go.mod >/dev/null 2>&1 || { echo "go.mod is not tidy; run 'go mod tidy'"; rm -rf $$tmpdir; exit 1; }; \
	 diff -u go.sum $$tmpdir/go.sum >/dev/null 2>&1 || { echo "go.sum is not tidy; run 'go mod tidy'"; rm -rf $$tmpdir; exit 1; }; \
	 rm -rf $$tmpdir

	@echo "Running golangci-lint..."
	@golangci-lint run

# Help target
help: ## Show this help message
	@echo "Available targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'
