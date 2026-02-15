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
- Create example config file at `~/.config/ori/resources.example.json`

## Usage

```bash
ori --config <path-to-resources.json>
```


## Uninstall

```bash
make uninstall
```


## Development

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
