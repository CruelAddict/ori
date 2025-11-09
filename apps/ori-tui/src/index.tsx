import { render, useKeyboard } from "@opentui/solid";
import { ConnectionView } from "@src/components/ConnectionView";
import {
    ConfigurationSelector,
    type ConnectStatusIndicator,
} from "@src/components/ConfigurationSelector";
import type { Configuration } from "@src/lib/configuration";
import {
    createOriClient,
    type ClientMode,
    type OriClient,
} from "@src/lib/configurationsClient";
import { CONNECTION_STATE_EVENT, type ServerEvent } from "@src/lib/events";
import { createLogger, type LogLevel } from "@src/lib/logger";
import type { Logger } from "pino";
import { Show, createEffect, createSignal, onCleanup } from "solid-js";

interface AppProps {
    host: string;
    port: number;
    mode: ClientMode;
    client: OriClient;
    logger: Logger;
    socketPath?: string;
}

function App(props: AppProps) {
    const [selectedConfiguration, setSelectedConfiguration] =
        createSignal<Configuration | null>(null);
    const [pendingConfiguration, setPendingConfiguration] =
        createSignal<Configuration | null>(null);
    const [connectState, setConnectState] =
        createSignal<ConnectStatusIndicator>({ status: "idle" });

    useKeyboard((evt) => {
        const name = evt.name?.toLowerCase();
        if (evt.ctrl && name === "c") {
            evt.preventDefault?.();
            process.exit(0);
        }
    });

    const resetConnectState = () => {
        setConnectState({ status: "idle" });
    };

    const handleServerEvent = (event: ServerEvent) => {
        if (event.type !== CONNECTION_STATE_EVENT) {
            return;
        }
        const payload = event.payload;
        props.logger.debug({ payload }, "tui received server event");

        if (payload.state === "connected") {
            const pending = pendingConfiguration();
            if (pending && pending.name === payload.configurationName) {
                setPendingConfiguration(null);
                resetConnectState();
                setSelectedConfiguration(pending);
            }
            return;
        }

        if (payload.state === "failed") {
            props.logger.error({ payload }, "connection failed via SSE");
            if (pendingConfiguration()?.name === payload.configurationName) {
                setPendingConfiguration(null);
                resetConnectState();
            }
            return;
        }

        if (
            payload.state === "connecting" &&
            pendingConfiguration()?.name === payload.configurationName
        ) {
            setConnectState({
                status: "waiting",
                configurationName: payload.configurationName,
                message: payload.message ?? "Waiting for backend...",
            });
        }
    };

    createEffect(() => {
        const dispose = props.client.openEventStream(handleServerEvent);
        onCleanup(() => dispose());
    });

    const handleConnect = async (configuration: Configuration) => {
        setPendingConfiguration(configuration);
        setConnectState({
            status: "requesting",
            configurationName: configuration.name,
            message: "Requesting connection...",
        });

        try {
            const result = await props.client.connect(configuration.name);
            if (result.result === "success") {
                setPendingConfiguration(null);
                resetConnectState();
                setSelectedConfiguration(configuration);
                return;
            }
            if (result.result === "fail") {
                props.logger.error(
                    { configuration: configuration.name, userMessage: result.userMessage },
                    "connect RPC returned fail"
                );
                setPendingConfiguration(null);
                resetConnectState();
                return;
            }
            setConnectState({
                status: "waiting",
                configurationName: configuration.name,
                message: result.userMessage ?? "Waiting for backend...",
            });
        } catch (err) {
            props.logger.error({ err, configuration: configuration.name }, "connect RPC error");
            setPendingConfiguration(null);
            resetConnectState();
        }
    };

    const handleBack = () => {
        setSelectedConfiguration(null);
        setPendingConfiguration(null);
        resetConnectState();
    };

    return (
        <Show
            when={selectedConfiguration()}
            keyed
            fallback={
                <ConfigurationSelector
                    host={props.host}
                    port={props.port}
                    mode={props.mode}
                    client={props.client}
                    socketPath={props.socketPath}
                    onConnect={handleConnect}
                    connectState={connectState()}
                />
            }
        >
            {(configuration: Configuration) => (
                <ConnectionView
                    configuration={configuration}
                    client={props.client}
                    logger={props.logger}
                    onBack={handleBack}
                />
            )}
        </Show>
    );
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

    const client = createOriClient({
        mode,
        host,
        port,
        socketPath,
        logger,
    });

    return render(
        () => (
            <App
                host={host}
                port={port}
                mode={mode}
                client={client}
                logger={logger}
                socketPath={socketPath}
            />
        ),
        { exitOnCtrlC: false }
    );
}

if (import.meta.main) {
    main();
}
