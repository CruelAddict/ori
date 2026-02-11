#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SPEC_FILE="$PROJECT_ROOT/libs/contract/openapi.yaml"
GO_DIR="$PROJECT_ROOT/libs/contract/go"
GO_CONFIG="$GO_DIR/oapi-codegen.yaml"
TS_DIR="$PROJECT_ROOT/libs/contract/typescript"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}=== Contract SDK Generation ===${NC}"
echo "Spec: $SPEC_FILE"

echo -e "${YELLOW}Validating spec file...${NC}"
if [ ! -f "$SPEC_FILE" ]; then
    echo -e "${RED}Error: spec file not found at $SPEC_FILE${NC}"
    exit 1
fi

if [ ! -f "$GO_CONFIG" ]; then
    echo -e "${RED}Error: Go generator config missing at $GO_CONFIG${NC}"
    exit 1
fi

pushd "$GO_DIR" >/dev/null
    echo -e "${YELLOW}Generating Go SDK...${NC}"
    GO111MODULE=on go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.3.0 \
        --config "$GO_CONFIG" \
        "$SPEC_FILE"
popd >/dev/null

echo -e "${YELLOW}Generating TypeScript SDK...${NC}"
rm -rf "$TS_DIR"
mkdir -p "$TS_DIR"

npx --yes @hey-api/openapi-ts@0.92.3 \
    --input "$SPEC_FILE" \
    --output "$TS_DIR" \
    --client @hey-api/client-fetch

cat <<'EOF' >"$TS_DIR/package.json"
{
  "name": "contract",
  "version": "0.1.0",
  "type": "module",
  "main": "./index.ts",
  "module": "./index.ts",
  "types": "./index.ts",
  "sideEffects": false,
  "dependencies": {}
}
EOF

echo -e "${GREEN}✓ Go SDK generated under $GO_DIR${NC}"
echo -e "${GREEN}✓ TypeScript SDK generated under $TS_DIR${NC}"
echo -e "${GREEN}=== Generation complete ===${NC}"
