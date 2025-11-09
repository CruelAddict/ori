#!/bin/bash

set -e

echo "Uninstalling ori..."

# Remove binaries
sudo rm -f /usr/local/bin/ori
sudo rm -r /usr/local/libexec/ori-be
sudo rm -r /usr/local/libexec/ori-tui

echo ""
echo "✓ Uninstall complete!"
echo ""
echo "Note: User config in ~/.config/ori/ was not removed"
echo "To remove it: rm -rf ~/.config/ori"
