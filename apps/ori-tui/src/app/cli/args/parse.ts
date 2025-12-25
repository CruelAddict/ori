import type { ClientMode } from "@shared/lib/configurations-client";
import type { LogLevel } from "@shared/lib/logger";
import type { ParsedArgs } from "./types";

type ArgHandler = {
  requiresValue: boolean;
  handle(value: string | undefined): void;
};

const VALID_LOG_LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

function normalizeLogLevel(value?: string, def: LogLevel = "warn"): LogLevel {
  if (!value) {
    return def;
  }
  const normalized = value.toLowerCase();
  if ((VALID_LOG_LEVELS as string[]).includes(normalized)) {
    return normalized as LogLevel;
  }
  return def;
}

function normalizeMode(value?: string, def: ClientMode = "sdk"): ClientMode {
  if (!value) {
    return def;
  }
  return value === "stub" ? "stub" : def;
}

export function parseArgs(args: string[]): ParsedArgs {
  let configPath: string | undefined;
  let backendPath: string | undefined;
  let socketPath: string | undefined;
  let serverAddress: string | undefined;
  let mode: ClientMode = "sdk";
  let logLevel: LogLevel = "warn";
  let logLevelSet = false;
  let theme: string | undefined;

  const markLogLevel = (value?: string) => {
    logLevel = normalizeLogLevel(value, logLevel);
    logLevelSet = value !== undefined;
  };

  const handlers: Record<string, ArgHandler> = {
    "--config": {
      requiresValue: true,
      handle: (v) => {
        if (v) {
          configPath = v;
        }
      },
    },
    "-config": {
      requiresValue: true,
      handle: (v) => {
        if (v) {
          configPath = v;
        }
      },
    },
    "--backend-path": {
      requiresValue: true,
      handle: (v) => {
        if (v) {
          backendPath = v;
        }
      },
    },
    "-backend-path": {
      requiresValue: true,
      handle: (v) => {
        if (v) {
          backendPath = v;
        }
      },
    },
    "--socket": {
      requiresValue: true,
      handle: (v) => {
        if (v) {
          socketPath = v;
        }
      },
    },
    "-socket": {
      requiresValue: true,
      handle: (v) => {
        if (v) {
          socketPath = v;
        }
      },
    },
    "--server": {
      requiresValue: true,
      handle: (v) => {
        if (v) {
          serverAddress = v;
        }
      },
    },
    "-server": {
      requiresValue: true,
      handle: (v) => {
        if (v) {
          serverAddress = v;
        }
      },
    },
    "--mode": {
      requiresValue: true,
      handle: (v) => {
        mode = normalizeMode(v, mode);
      },
    },
    "-mode": {
      requiresValue: true,
      handle: (v) => {
        mode = normalizeMode(v, mode);
      },
    },
    "--log-level": {
      requiresValue: true,
      handle: (v) => {
        markLogLevel(v);
      },
    },
    "-log-level": {
      requiresValue: true,
      handle: (v) => {
        markLogLevel(v);
      },
    },
    "--theme": {
      requiresValue: true,
      handle: (v) => {
        if (v) {
          theme = v;
        }
      },
    },
    "-theme": {
      requiresValue: true,
      handle: (v) => {
        if (v) {
          theme = v;
        }
      },
    },
    "--stub": {
      requiresValue: false,
      handle: () => {
        mode = "stub";
      },
    },
    "--sdk": {
      requiresValue: false,
      handle: () => {
        mode = "sdk";
      },
    },
  };

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    const handler = handlers[token];
    if (!handler) {
      continue;
    }
    const nextValue = handler.requiresValue ? args[index + 1] : undefined;
    handler.handle(nextValue);
    if (handler.requiresValue && nextValue !== undefined) {
      index += 1;
    }
  }

  return {
    configPath,
    backendPath,
    logLevel,
    logLevelSet,
    socketPath,
    serverAddress,
    mode,
    theme,
  };
}
