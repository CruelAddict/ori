# Ori

Terminal UI database explorer. WIP, can do precisely nothing at this point

## Installation


```bash
make install
```

This will:
- Build all components
- Install `ori` using a user-local managed layout under `~/.ori/`
- Place versioned binaries in `~/.ori/releases/<release-id>/` and switch `~/.ori/current` atomically
- Create launcher at `~/.ori/bin/ori`
- Prune old releases automatically if they are no longer in use
- Add `~/.ori/bin` to your shell PATH (unless `--no-modify-path` is used)
- Create example config file at `$XDG_CONFIG_HOME/ori/resources.example.json` (or `~/.config/ori/resources.example.json`)

## Usage

```bash
ori --config <path-to-resources.json>
```

### Linux keychain

On Linux, the `keychain` password provider auto-detects Secret Service first, then `pass`.

```bash
secret-tool store --label="ori.db kc_pg_user" service ori.db account kc_pg_user
pass insert ori.db/kc_pg_user
```

Use `ORI_KEYCHAIN_PROVIDER=secret-service`, `pass`, or `none` to force a provider.


## Uninstall

```bash
make uninstall
```


## Development

### Prerequisites

- Go 1.24+
- Bun
- GNU Make
- Docker Compose is optional and only needed for `make postgres-up`

The build does not install toolchains automatically. Make targets fail early with an install hint when Bun is missing.

### Strict Contract Check

```bash
make contract-check
```

This command fails if generated contract SDKs are out of date.

### Project Structure

```
apps/
  ori-be/      # Backend
  ori-tui/     # Terminal UI + CLI entrypoint
libs/
  rpc-contract/ # RPC contract definition
  sdk/         # Client SDKs (Go, TypeScript)
```
