# Ori

Terminal UI database explorer. WIP, can do precisely nothing at this point

## Installation


```bash
make install
```

This will:
- Build all components
- Install `ori` to `/usr/local/bin/`
- Install backend `ori-be` to `/usr/local/libexec/`
- Create empty config file at `~/.config/ori/config.example.yaml`

## Usage

```bash
ori --config <path-to-config.yaml>
```


## Uninstall

```bash
make uninstall
```


## Development

### Project Structure

```
apps/
  ori-be/      # Backend
  ori-tui/     # Terminal UI + CLI entrypoint
libs/
  rpc-contract/ # RPC contract definition
  sdk/         # Client SDKs (Go, TypeScript)
```
