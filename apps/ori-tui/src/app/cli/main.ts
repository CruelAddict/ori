import { startTui } from "@app/start-tui"
import { parseArgs } from "@cli/args/parse"
import type { BackendHandle } from "@cli/runtime/backend"
import { cleanupStaleSockets, ensureBackend } from "@cli/runtime/backend"
import { resolveConfigPath } from "@cli/runtime/config"
import { ensureRuntimeDir, socketPathForConfig } from "@cli/runtime/paths"
import { createLogger } from "@shared/lib/logger"

function parseServer(address?: string): { host: string; port: number } {
  if (!address) {
    return { host: "localhost", port: 8080 }
  }
  const [hostPart, portPart] = address.split(":")
  const host = hostPart && hostPart.length > 0 ? hostPart : "localhost"
  const parsedPort = parseInt(portPart ?? "", 10)
  const port = Number.isFinite(parsedPort) ? parsedPort : 8080
  return { host, port }
}

function installShutdownHooks(backend?: BackendHandle) {
  let shuttingDown = false

  const closeBackend = () => {
    if (!backend || !backend.started || !backend.process) {
      return
    }
    try {
      backend.pipe?.end()
    } catch {}
    try {
      backend.process.kill("SIGTERM")
    } catch {}
  }

  const shutdown = () => {
    if (shuttingDown) {
      return
    }
    shuttingDown = true
    closeBackend()
  }

  process.on("exit", shutdown)
  process.on("SIGINT", () => {
    shutdown()
    process.exit(0)
  })
  process.on("SIGTERM", () => {
    shutdown()
    process.exit(0)
  })
}

export async function main(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv)
  const logger = createLogger("ori", parsed.logLevel)

  let host: string | undefined
  let port: number | undefined
  let socketPath: string | undefined
  let backendHandle: BackendHandle | undefined

  try {
    const configPath = await resolveConfigPath(parsed.configPath)

    if (parsed.serverAddress) {
      const server = parseServer(parsed.serverAddress)
      host = server.host
      port = server.port
    } else {
      const runtimeDir = await ensureRuntimeDir()
      await cleanupStaleSockets(runtimeDir, logger)
      socketPath = parsed.socketPath ?? socketPathForConfig(runtimeDir, configPath)
    }

    backendHandle = await ensureBackend({
      host,
      port,
      socketPath,
      backendPathOverride: parsed.backendPath,
      configPath,
      logLevel: parsed.logLevel,
      logLevelSet: parsed.logLevelSet,
      logger,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error({ err }, `failed to connect to backend: ${message}`)
    process.exit(1)
  }

  installShutdownHooks(backendHandle)
  startTui({
    mode: parsed.mode,
    socketPath,
    host,
    port,
    logLevel: parsed.logLevel,
    theme: parsed.theme,
    logger,
  })
}

if (import.meta.main) {
  void main()
}
