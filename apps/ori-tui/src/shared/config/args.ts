import type { ClientMode } from "@shared/lib/configurations-client";
import type { LogLevel } from "@shared/lib/logger";

export type ParsedArgs = {
    serverAddress: string;
    socketPath?: string;
    mode: ClientMode;
    logLevel: LogLevel;
    theme?: string;
};

export function parseArgs(args: string[]): ParsedArgs {
    let serverAddress = "localhost:8080";
    let socketPath: string | undefined;
    let mode: ClientMode = "sdk";
    let logLevel: LogLevel = "warn";
    let theme: string | undefined;

    const setModeFromValue = (value?: string) => {
        if (!value) {
            return;
        }
        mode = value === "stub" ? "stub" : "sdk";
    };

    const setLogLevelFromValue = (value?: string) => {
        if (!value) {
            return;
        }
        const normalized = value.toLowerCase();
        if (normalized === "debug" || normalized === "info" || normalized === "warn" || normalized === "error") {
            logLevel = normalized as LogLevel;
        }
    };

    type ArgHandler = {
        requiresValue: boolean;
        handle(value: string | undefined): void;
    };

    const handlers: Record<string, ArgHandler> = {
        "--server": {
            requiresValue: true,
            handle: (value) => {
                if (value) {
                    serverAddress = value;
                }
            },
        },
        "--socket": {
            requiresValue: true,
            handle: (value) => {
                if (value) {
                    socketPath = value;
                }
            },
        },
        "--mode": {
            requiresValue: true,
            handle: setModeFromValue,
        },
        "--log-level": {
            requiresValue: true,
            handle: setLogLevelFromValue,
        },
        "--theme": {
            requiresValue: true,
            handle: (value) => {
                if (value) {
                    theme = value;
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

    return { serverAddress, socketPath, mode, logLevel, theme };
}
