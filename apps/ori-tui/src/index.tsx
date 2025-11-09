import { render } from "@opentui/solid";
import { Show } from "solid-js";
import { ConfigurationSelector } from "@src/components/ConfigurationSelector";
import { ConnectionView } from "@src/components/ConnectionView";
import { createLogger, type LogLevel } from "@src/lib/logger";
import type { ClientMode } from "@src/lib/configurationsClient";
import { LoggerProvider } from "@src/providers/logger";
import { ClientProvider } from "@src/providers/client";
import { ConfigurationsProvider } from "@src/providers/configurations";
import { ConnectionStateProvider, useConnectionState } from "@src/providers/connectionState";
import { KeymapProvider, useScopedKeymap } from "@src/providers/keymap";

function App() {
    const connectionState = useConnectionState();
    const focusedName = connectionState.focusedConfigurationName;

    return (
        <>
            <GlobalHotkeys />
            <Show when={focusedName()} fallback={<ConfigurationSelector />} keyed>
                {(configurationName: string) => (
                    <ConnectionView
                        configurationName={configurationName}
                        onBack={() => connectionState.focus(null)}
                    />
                )}
            </Show>
        </>
    );
}

function GlobalHotkeys() {
    useScopedKeymap("global", [
        {
            pattern: "ctrl+c",
            handler: () => {
                process.exit(0);
            },
            preventDefault: true,
        },
    ]);
    return null;
}

interface ParsedArgs {
    serverAddress: string;
    socketPath?: string;
    mode: ClientMode;
    logLevel: LogLevel;
}

function parseArgs(args: string[]): ParsedArgs {
    let serverAddress = "localhost:8080";
    let socketPath: string | undefined;
    let mode: ClientMode = "sdk";
    let logLevel: LogLevel = "warn";

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

        if (arg === "--stub") {
            mode = "stub";
            continue;
        }

        if (arg === "--sdk") {
            mode = "sdk";
            continue;
        }
    }

    return { serverAddress, socketPath, mode, logLevel };
}

export function main() {
    const args = process.argv.slice(2);
    const { serverAddress, socketPath, mode, logLevel } = parseArgs(args);

    const [host, portStr] = serverAddress.split(":");
    const port = parseInt(portStr ?? "", 10) || 8080;

    const logger = createLogger("ori-tui", logLevel);
    logger.info({ host, port, mode, socketPath }, "tui started");

    render(
        () => (
            <LoggerProvider logger={logger}>
                <ClientProvider
                    options={{
                        mode,
                        host,
                        port,
                        socketPath,
                    }}
                >
                    <ConfigurationsProvider>
                        <ConnectionStateProvider>
                            <KeymapProvider>
                                <App />
                            </KeymapProvider>
                        </ConnectionStateProvider>
                    </ConfigurationsProvider>
                </ClientProvider>
            </LoggerProvider>
        ),
        { exitOnCtrlC: false }
    );
}

if (import.meta.main) {
    main();
}
