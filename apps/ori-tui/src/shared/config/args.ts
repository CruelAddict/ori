import type { ClientMode } from "@shared/lib/configurations-client";
import type { LogLevel } from "@shared/lib/logger";

export interface ParsedArgs {
    serverAddress: string;
    socketPath?: string;
    mode: ClientMode;
    logLevel: LogLevel;
    theme?: string;
}

export function parseArgs(args: string[]): ParsedArgs {
    let serverAddress = "localhost:8080";
    let socketPath: string | undefined;
    let mode: ClientMode = "sdk";
    let logLevel: LogLevel = "warn";
    let theme: string | undefined;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === "--server" && i + 1 < args.length) {
            serverAddress = args[i + 1];
            i++;
            continue;
        }

        if (arg === "--socket" && i + 1 < args.length) {
            socketPath = args[i + 1];
            i++;
            continue;
        }

        if (arg === "--mode" && i + 1 < args.length) {
            const value = args[i + 1];
            mode = value === "stub" ? "stub" : "sdk";
            i++;
            continue;
        }

        if (arg === "--log-level" && i + 1 < args.length) {
            const val = args[i + 1]?.toLowerCase();
            if (val === "debug" || val === "info" || val === "warn" || val === "error") {
                logLevel = val as LogLevel;
            }
            i++;
            continue;
        }

        if (arg === "--theme" && i + 1 < args.length) {
            theme = args[i + 1];
            i++;
            continue;
        }

        if (arg === "--stub") {
            mode = "stub";
            continue;
        }

        if (arg === "--sdk") {
            mode = "sdk";
            continue;
        }
    }

    return { serverAddress, socketPath, mode, logLevel, theme };
}
