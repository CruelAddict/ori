#!/bin/bash

set -e

echo "Uninstalling ori..."

# Remove binaries
sudo rm -f /usr/local/bin/ori
sudo rm -f /usr/local/bin/ori-tui
sudo rm -rf /usr/local/lib/ori

echo ""
echo "✓ Uninstall complete!"
echo ""
echo "Note: User config in ~/.config/ori/ was not removed"
echo "To remove it: rm -rf ~/.config/ori"
