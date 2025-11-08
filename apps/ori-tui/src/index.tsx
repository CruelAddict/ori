import { render } from "@opentui/solid";
import { ConnectionView } from "@src/components/ConnectionView";
import { ConfigurationSelector } from "@src/components/ConfigurationSelector";
import type { Configuration } from "@src/lib/configuration";
import {
    createConfigurationsClient,
    type ClientMode,
    type ConfigurationsClient,
} from "@src/lib/configurationsClient";
import { Show, createSignal } from "solid-js";

interface AppProps {
    host: string;
    port: number;
    mode: ClientMode;
    client: ConfigurationsClient;
    socketPath?: string;
}

function App(props: AppProps) {
    const [selectedConfiguration, setSelectedConfiguration] =
        createSignal<Configuration | null>(null);

    const handleSelect = (configuration: Configuration) => {
        setSelectedConfiguration(configuration);
    };

    const handleBack = () => {
        setSelectedConfiguration(null);
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
                    onSelect={handleSelect}
                />
            }
        >
            {(configuration: Configuration) => (
                <ConnectionView configuration={configuration} onBack={handleBack} />
            )}
        </Show>
    );
}

interface ParsedArgs {
    serverAddress: string;
    socketPath?: string;
    mode: ClientMode;
}

function parseArgs(args: string[]): ParsedArgs {
    let serverAddress = "localhost:8080";
    let socketPath: string | undefined;
    let mode: ClientMode = "sdk";

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

        if (arg === "--stub") {
            mode = "stub";
            continue;
        }

        if (arg === "--sdk") {
            mode = "sdk";
            continue;
        }
    }

    return { serverAddress, socketPath, mode };
}

export function main() {
    const args = process.argv.slice(2);
    const { serverAddress, socketPath, mode } = parseArgs(args);

    const [host, portStr] = serverAddress.split(":");
    const port = parseInt(portStr ?? "", 10) || 8080;

    const client = createConfigurationsClient({
        mode,
        host,
        port,
        socketPath,
    });

    return render(() => (
        <App host={host} port={port} mode={mode} client={client} socketPath={socketPath} />
    ));
}

if (import.meta.main) {
    main();
}
