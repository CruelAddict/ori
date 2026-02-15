.PHONY: build clean install uninstall test demo postgres-up postgres-down postgres-clean contract-ts-install contract-check

build:
	@echo "Building all components..."
	@$(MAKE) -C apps/ori-be build
	@$(MAKE) contract-ts-install
	@$(MAKE) -C apps/ori-tui build
	@echo "Build complete!"

clean:
	@echo "Cleaning all components..."
	@$(MAKE) -C apps/ori-be clean
	@$(MAKE) -C apps/ori-tui clean
	@echo "Clean complete!"

install: build
	@./scripts/install.sh

uninstall:
	@./scripts/uninstall.sh

contract-ts-install:
	@echo "Installing contract TypeScript dependencies..."
	@(cd libs/contract/typescript && bun install)

test:
	@echo "Running tests..."
	@$(MAKE) -C apps/ori-be test
	@echo "Tests complete!"

contract-check:
	@./scripts/contract_check_strict.sh

# Build everything and run the CLI with the test config
demo: build
	@echo "Starting demo with test config..."
	@./apps/ori-tui/bin/ori --config testdata/resources.json --log-level debug --backend-path ./apps/ori-be/bin/ori-be

# PostgreSQL test database management
postgres-up:
	@echo "Resetting PostgreSQL test database (fresh volume)..."
	@docker compose -f testdata/docker-compose.yaml down -v --remove-orphans
	@docker compose -f testdata/docker-compose.yaml up -d
	@echo "PostgreSQL is running on localhost:5433"

postgres-down:
	@echo "Stopping PostgreSQL test database..."
	@docker compose -f testdata/docker-compose.yaml down --remove-orphans

postgres-clean:
	@echo "Removing PostgreSQL test database and volumes..."
	@docker compose -f testdata/docker-compose.yaml down -v
