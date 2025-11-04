#!/bin/bash

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONTRACT_PATH="$PROJECT_ROOT/libs/rpc-contract/contract.json"
TS_SDK_PATH="$PROJECT_ROOT/libs/sdk/typescript"

echo -e "${GREEN}=== OpenRPC TypeScript SDK Generator ===${NC}"
echo "Contract: $CONTRACT_PATH"
echo ""

# Validate contract exists
if [ ! -f "$CONTRACT_PATH" ]; then
    echo -e "${RED}Error: Contract file not found at $CONTRACT_PATH${NC}"
    exit 1
fi

# Validate contract is valid JSON
if ! jq empty "$CONTRACT_PATH" 2>/dev/null; then
    echo -e "${RED}Error: Contract is not valid JSON${NC}"
    exit 1
fi

# Check if open-rpc-generator is installed
if ! command -v open-rpc-generator &>/dev/null; then
    echo -e "${RED}Error: open-rpc-generator is not installed${NC}"
    echo -e "${YELLOW}Install it: npm install -g @open-rpc/generator${NC}"
    exit 1
fi

# Generate TypeScript client
echo -e "${YELLOW}Generating TypeScript SDK...${NC}"
TMP_DIR=$(mktemp -d)

open-rpc-generator generate \
    -d "$CONTRACT_PATH" \
    -l typescript \
    -t client \
    -o "$TMP_DIR" \
    >/dev/null 2>&1

# Replace SDK directory with generated client
if [ -d "$TMP_DIR/client/typescript" ]; then
    rm -rf "$TS_SDK_PATH"
    mv "$TMP_DIR/client/typescript" "$TS_SDK_PATH"
fi

rm -rf "$TMP_DIR"

echo -e "${GREEN}✓ TypeScript SDK generated at $TS_SDK_PATH${NC}"
echo ""
echo -e "${GREEN}=== Generation Complete ===${NC}"
echo -e "${YELLOW}Note: Go SDK types are maintained manually in libs/sdk/go/types.go${NC}"
