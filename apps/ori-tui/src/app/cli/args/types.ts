import type { LogLevel } from "@utils/logger"

export type ParsedArgs = {
  resourcesPath?: string
  backendPath?: string
  logLevel: LogLevel
  logLevelSet: boolean
  socketPath?: string
  serverAddress?: string
  theme?: string
}
