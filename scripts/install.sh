#!/bin/bash

set -e

echo "Installing ori..."
echo ""

# Build all components
make build

# Create installation directories
sudo mkdir -p /usr/local/bin
sudo mkdir -p /usr/local/lib/ori

# Install binaries
echo "Installing binaries..."
sudo cp apps/ori-cli/bin/ori /usr/local/bin/ori
sudo cp apps/ori-be/bin/ori-be /usr/local/lib/ori/ori-be
sudo cp apps/ori-tui/bin/ori-tui /usr/local/bin/ori-tui

# Create config directory
mkdir -p ~/.config/ori
if [ ! -f ~/.config/ori/config.yaml ]; then
    cp testdata/config.yaml ~/.config/ori/config.example.yaml
    echo "Example config copied to ~/.config/ori/config.example.yaml"
fi

echo ""
echo "✓ Installation complete!"
echo ""
echo "Get started:"
echo "  ori --config ~/.config/ori/config.example.yaml"
echo ""
echo "To uninstall:"
echo "  ./scripts/uninstall.sh"
