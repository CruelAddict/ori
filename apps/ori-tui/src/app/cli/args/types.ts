import type { LogLevel } from "@shared/lib/logger"

export type ParsedArgs = {
  resourcesPath?: string
  backendPath?: string
  logLevel: LogLevel
  logLevelSet: boolean
  socketPath?: string
  serverAddress?: string
  theme?: string
}
