# Scripts

## generate_openrpc_sdk.sh

Generates TypeScript SDK from the OpenRPC contract specification.

### Prerequisites

**Must be installed before running:**

```bash
npm install -g @open-rpc/generator
```

Also requires `jq` for JSON validation.

### Usage

```bash
./scripts/generate_openrpc_sdk.sh
```

### What it does

1. Validates the OpenRPC contract JSON
2. Generates TypeScript client using `@open-rpc/generator` to `libs/sdk/typescript/`

### Go SDK

The Go SDK types are **handwritten** in `libs/sdk/go/types.go` and maintained manually to match the contract.

### Integration

- **Server**: Uses SDK types directly via `orisdk` package
- **Handlers**: Located in `apps/server/internal/rpc/handlers/`, one handler per RPC method
- **Internal models**: YAML-tagged types for config loading, converted to SDK types via `ToSDK()` method
