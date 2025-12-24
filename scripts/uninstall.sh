#!/bin/bash

set -e

echo "Uninstalling ori..."

# Remove binaries
sudo rm -f /usr/local/bin/ori
sudo rm -f /usr/local/libexec/ori-be

echo ""
echo "✓ Uninstall complete!"
echo ""
echo "Note: User config in ~/.config/ori/ was not removed"
echo "To remove it: rm -rf ~/.config/ori"
