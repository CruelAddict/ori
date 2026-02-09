#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "$PROJECT_ROOT"

echo "[contract-check] Regenerating SDKs"
./scripts/generate_contract_sdks.sh

echo "[contract-check] Verifying generated SDKs are committed"
if ! git diff --quiet -- libs/contract/go libs/contract/typescript; then
  echo "[contract-check] Contract SDK drift detected. Run ./scripts/generate_contract_sdks.sh and commit changes."
  git status --short -- libs/contract/go libs/contract/typescript
  exit 1
fi

echo "[contract-check] OK"
