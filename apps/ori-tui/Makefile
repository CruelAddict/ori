.PHONY: build clean install dev lint lint-fix check-bun

BINARY_NAME=ori
BIN_DIR=bin

build: check-bun
	@echo "Building $(BINARY_NAME)..."
	@mkdir -p $(BIN_DIR)
	@bun install
	@bun run build.ts
	@echo "✓ Build complete: $(BIN_DIR)/$(BINARY_NAME)"

clean:
	@echo "Cleaning..."
	@rm -rf $(BIN_DIR) dist

dev: check-bun
	@bun run --watch src/index.tsx

install: build
	@echo "Installing $(BINARY_NAME) to /usr/local/bin/..."
	@sudo cp $(BIN_DIR)/$(BINARY_NAME) /usr/local/bin/
	@echo "Installation complete"

lint: check-bun
	@bun x biome check --reporter summary

lint-fix: check-bun
	@bun x biome check --write

check-bun:
	@command -v bun >/dev/null || { echo "bun is required. Install it from https://bun.sh/docs/installation"; exit 1; }
