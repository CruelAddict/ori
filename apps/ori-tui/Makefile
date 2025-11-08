.PHONY: build clean install dev

BINARY_NAME=ori-tui
BIN_DIR=bin

build:
	@echo "Building $(BINARY_NAME)..."
	@mkdir -p $(BIN_DIR)
	@bun install
	@bun run build.ts
	@strip $(BIN_DIR)/$(BINARY_NAME) 2>/dev/null || true
	@echo "✓ Build complete: $(BIN_DIR)/$(BINARY_NAME)"

clean:
	@echo "Cleaning..."
	@rm -rf $(BIN_DIR) dist

dev:
	@bun run --watch src/index.tsx

install: build
	@echo "Installing $(BINARY_NAME) to /usr/local/bin/..."
	@sudo cp $(BIN_DIR)/$(BINARY_NAME) /usr/local/bin/
	@echo "Installation complete"
