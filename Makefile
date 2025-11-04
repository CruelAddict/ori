.PHONY: build clean install uninstall test

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
