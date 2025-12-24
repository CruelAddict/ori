import type { ClientMode } from "@shared/lib/configurations-client";
import type { LogLevel } from "@shared/lib/logger";

export type ParsedArgs = {
    configPath?: string;
    backendPath?: string;
    logLevel: LogLevel;
    logLevelSet: boolean;
    socketPath?: string;
    socketProvided: boolean;
    serverAddress?: string;
    serverProvided: boolean;
    mode: ClientMode;
    theme?: string;
};
