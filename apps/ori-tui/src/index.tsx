import { TextAttributes } from "@opentui/core";
import { render } from "@opentui/solid";
import { createSignal, onMount, For } from "solid-js";
import OriDatabaseExplorerAPI from "ori-sdk";

interface Connection {
    name: string;
    type: string;
    host: string;
    port: number;
    database: string;
    username: string;
}

function App(props: { host: string; port: number }) {
    const [connections, setConnections] = createSignal<Connection[]>([]);
    const [selectedIndex, setSelectedIndex] = createSignal(0);
    const [loading, setLoading] = createSignal(true);
    const [error, setError] = createSignal<string | null>(null);

    let client: OriDatabaseExplorerAPI | null = null;

    onMount(async () => {
        try {
            client = new OriDatabaseExplorerAPI({
                transport: {
                    type: "http",
                    host: props.host,
                    port: props.port,
                    path: "/rpc",
                },
            });

            const result = await client.listConfigurations();
            setConnections(result.connections || []);
            setLoading(false);
        } catch (err) {
            setError(`Failed to connect to server: ${err}`);
            setLoading(false);
        }

        // Handle keyboard input
        process.stdin.setRawMode(true);
        process.stdin.on("data", (key) => {
            const keyStr = key.toString();

            // Ctrl+C to exit
            if (keyStr === "\u0003") {
                process.exit(0);
            }

            // Arrow up
            if (keyStr === "\u001b[A") {
                setSelectedIndex((prev) => Math.max(0, prev - 1));
            }

            // Arrow down
            if (keyStr === "\u001b[B") {
                setSelectedIndex((prev) => Math.min(connections().length - 1, prev + 1));
            }
        });
    });

    return (
        <box flexDirection="column" flexGrow={1} padding={1}>
            <text attributes={TextAttributes.BOLD}>Ori Database Explorer</text>
            <text attributes={TextAttributes.DIM}>
                Server: {props.host}:{props.port}
            </text>
            <box height={1} />

            {loading() ? (
                <text>Loading configurations...</text>
            ) : error() ? (
                <text fg="red">{error()}</text>
            ) : (
                <box flexDirection="column">
                    <text attributes={TextAttributes.BOLD}>Connections:</text>
                    <box height={1} />
                    <For each={connections()}>
                        {(conn, index) => (
                            <box flexDirection="row">
                                <text
                                    fg={index() === selectedIndex() ? "cyan" : undefined}
                                    attributes={
                                        index() === selectedIndex()
                                            ? TextAttributes.BOLD
                                            : TextAttributes.NONE
                                    }
                                >
                                    {index() === selectedIndex() ? "> " : "  "}
                                    {conn.name} ({conn.type}) - {conn.host}:{conn.port}/{conn.database}
                                </text>
                            </box>
                        )}
                    </For>
                    <box height={1} />
                    <text attributes={TextAttributes.DIM}>
                        Use ↑/↓ arrows to navigate, Ctrl+C to exit
                    </text>
                </box>
            )}
        </box>
    );
}

export function main() {
    // Parse command line arguments
    const args = process.argv.slice(2);
    let serverAddress = "localhost:8080";

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--server" && i + 1 < args.length) {
            serverAddress = args[i + 1];
            break;
        }
    }

    const [host, portStr] = serverAddress.split(":");
    const port = parseInt(portStr) || 8080;

    // Return promise to prevent immediate exit
    return new Promise<void>((resolve) => {
        render(() => <App host={host} port={port} />);
    });
}

// Run main if this is the entry point
if (import.meta.main) {
    main();
}
