#!/usr/bin/env bash

set -euo pipefail

echo "Uninstalling ori..."

INSTALL_ROOT="${ORI_HOME:-$HOME/.ori}"

# Remove user-local managed installation
rm -rf "$INSTALL_ROOT"

# Best-effort cleanup for legacy system-wide installs
rm -f /usr/local/bin/ori /usr/local/libexec/ori-be 2>/dev/null || true

echo ""
echo "✓ Uninstall complete!"
echo ""
echo "User config in ~/.config/ori/ was not removed"
echo "To remove it: rm -rf ~/.config/ori"
