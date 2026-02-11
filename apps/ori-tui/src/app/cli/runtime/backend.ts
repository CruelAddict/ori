import { type ChildProcess, type StdioOptions, spawn } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import type { LogLevel } from "@shared/lib/logger"
import type { Logger } from "pino"

type BunRequestInit = RequestInit & { unix?: string }

export type BackendHandle = {
  socketPath: string
  process?: ChildProcess
  pipe?: NodeJS.WritableStream | null
  started: boolean
}

export async function healthcheckUnix(socketPath: string, timeoutMs: number): Promise<boolean> {
  try {
    const response = await fetch("http://localhost/health", {
      signal: AbortSignal.timeout(timeoutMs),
      unix: socketPath,
    } as BunRequestInit)
    if (response.status !== 200) {
      return false
    }
    const bodyText = await response.text()
    return bodyText.startsWith("ok")
  } catch {
    return false
  }
}

export async function healthcheckTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
  try {
    const response = await fetch(`http://${host}:${port}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (response.status !== 200) {
      return false
    }
    const bodyText = await response.text()
    return bodyText.startsWith("ok")
  } catch {
    return false
  }
}

export async function cleanupStaleSockets(runtimeDir: string, logger?: Logger) {
  let entries: Array<{ name: string; isDirectory(): boolean }> = []
  try {
    entries = await fs.readdir(runtimeDir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      continue
    }
    if (!entry.name.startsWith("ori-") || !entry.name.endsWith(".sock")) {
      continue
    }
    const socketPath = path.join(runtimeDir, entry.name)
    const healthy = await healthcheckUnix(socketPath, 200)
    if (!healthy) {
      logger?.debug?.({ socketPath }, "removing stale socket")
      try {
        await fs.unlink(socketPath)
      } catch {
        // ignore cleanup failures
      }
    }
  }
}

export async function findBackendBinary(overridePath?: string): Promise<string> {
  if (overridePath) {
    try {
      await fs.access(overridePath)
      return overridePath
    } catch {
      throw new Error(`backend binary override not found: ${overridePath}`)
    }
  }

  const execDir = path.dirname(process.execPath)
  const candidate = path.resolve(execDir, "..", "libexec", "ori-be")
  try {
    await fs.access(candidate)
    return candidate
  } catch {
    // fallthrough
  }

  throw new Error("unable to locate ori-be binary; specify --backend-path")
}

async function waitForHealthy(socketPath: string, logger: Logger, attempts = 20, delayMs = 100) {
  for (let i = 0; i < attempts; i += 1) {
    if (await healthcheckUnix(socketPath, 400)) {
      return
    }
    logger.debug({ attempt: i + 1, socketPath }, "waiting for backend health")
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
  throw new Error("backend failed to become healthy in time")
}

export async function ensureBackendSocket(options: {
  socketPath: string
  backendPathOverride?: string
  configPath: string
  logLevel?: LogLevel
  logLevelSet: boolean
  logger: Logger
}): Promise<BackendHandle> {
  const { socketPath, backendPathOverride, configPath, logLevel, logLevelSet, logger } = options
  const healthy = await healthcheckUnix(socketPath, 400)
  if (healthy) {
    logger.info({ socketPath }, "reusing healthy backend")
    return { socketPath, started: false }
  }

  try {
    await fs.unlink(socketPath)
  } catch {}

  const backendPath = await findBackendBinary(backendPathOverride)
  const args = ["-config", configPath, "-socket", socketPath]
  if (logLevelSet && logLevel) {
    args.push("-log-level", logLevel)
  }

  logger.info({ backendPath, socketPath, args }, "starting backend")

  const stdio: StdioOptions = ["inherit", "inherit", "inherit", "pipe"]
  let child: ChildProcess
  try {
    child = spawn(backendPath, args, { stdio })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`failed to start backend: ${message}`)
  }

  child.on("error", (err) => {
    logger.error({ err }, "backend process error")
  })

  child.on("exit", (code, signal) => {
    logger.info({ code, signal }, "backend exited")
  })

  const pipe = child.stdio[3] as NodeJS.WritableStream | null

  try {
    await waitForHealthy(socketPath, logger)
    logger.info({ socketPath }, "backend is healthy")
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error({ err }, "backend failed healthcheck after start")
    try {
      child.kill("SIGKILL")
    } catch {}
    throw new Error(message)
  }

  return { socketPath, process: child, pipe, started: true }
}

async function ensureBackendTCP(options: { host: string; port: number; logger: Logger }): Promise<void> {
  const { host, port, logger } = options
  const healthy = await healthcheckTcp(host, port, 400)
  if (healthy) {
    logger.info({ host, port }, "backend is healthy")
  } else {
    throw new Error(`backend at ${host}:${port} is not healthy`)
  }
}

export async function ensureBackend(options: {
  host?: string
  port?: number
  socketPath?: string
  configPath?: string
  backendPathOverride?: string
  logLevel?: LogLevel
  logLevelSet: boolean
  logger: Logger
}): Promise<BackendHandle | undefined> {
  if (options.host !== undefined && options.port !== undefined) {
    await ensureBackendTCP({ host: options.host, port: options.port, logger: options.logger })
    return undefined
  }

  if (!options.socketPath) {
    throw new Error("socketPath is required for ensureBackend when host/port not provided")
  }
  if (!options.configPath) {
    throw new Error("configPath is required for ensureBackend when host/port not provided")
  }

  return ensureBackendSocket({
    socketPath: options.socketPath,
    backendPathOverride: options.backendPathOverride,
    configPath: options.configPath,
    logLevel: options.logLevel,
    logLevelSet: options.logLevelSet,
    logger: options.logger,
  })
}
