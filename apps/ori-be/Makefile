.PHONY: build test clean run help

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
	@./$(BIN_DIR)/$(BINARY_NAME) -config ./config.yaml

# Download and tidy dependencies
deps: ## Download and tidy Go dependencies
	@echo "Downloading dependencies..."
	@$(GOMOD) download
	@$(GOMOD) tidy
	@echo "Dependencies updated"

# Help target
help: ## Show this help message
	@echo "Available targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'
