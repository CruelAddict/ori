.PHONY: build clean install uninstall test demo postgres-up postgres-down postgres-clean

build:
	@echo "Building all components..."
	@$(MAKE) -C apps/ori-be build
	@$(MAKE) -C apps/ori-cli build
	@$(MAKE) -C apps/ori-tui build
	@echo "Build complete!"

clean:
	@echo "Cleaning all components..."
	@$(MAKE) -C apps/ori-be clean
	@$(MAKE) -C apps/ori-cli clean
	@$(MAKE) -C apps/ori-tui clean
	@echo "Clean complete!"

install: build
	@./scripts/install.sh

uninstall:
	@./scripts/uninstall.sh

test:
	@echo "Running tests..."
	@$(MAKE) -C apps/ori-be test
	@echo "Tests complete!"

# Build everything and run the CLI with the test config
demo: build
	@echo "Starting demo with test config..."
	@./apps/ori-cli/bin/ori -config testdata/config.yaml --log-level debug --ori-be-path ./apps/ori-be/bin/ori-be --ori-tui-path ./apps/ori-tui/bin/ori-tui

# PostgreSQL test database management
postgres-up:
	@echo "Starting PostgreSQL test database..."
	@docker compose -f testdata/docker-compose.yaml up -d
	@echo "PostgreSQL is running on localhost:5433"

postgres-down:
	@echo "Stopping PostgreSQL test database..."
	@docker compose -f testdata/docker-compose.yaml down

postgres-clean:
	@echo "Removing PostgreSQL test database and volumes..."
	@docker compose -f testdata/docker-compose.yaml down -v
