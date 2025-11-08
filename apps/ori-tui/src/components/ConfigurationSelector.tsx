import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/solid";
import { Keybind, useKeybind } from "@src/lib/keybind";
import type { Configuration } from "@src/lib/configuration";
import type {
    ClientMode,
    ConfigurationsClient,
} from "@src/lib/configurationsClient";
import { For, createEffect, createMemo, createSignal, onCleanup } from "solid-js";

export interface KeybindAction {
    keybind: string;
    onTrigger: (configuration: Configuration) => void;
}

export interface ConfigurationSelectorProps {
    host: string;
    port: number;
    mode: ClientMode;
    client: ConfigurationsClient;
    socketPath?: string;
    onSelect?: (configuration: Configuration) => void;
    keybind?: KeybindAction[];
}

export function ConfigurationSelector(props: ConfigurationSelectorProps) {
    const [configurations, setConfigurations] = createSignal<Configuration[]>([]);
    const [selectedIndex, setSelectedIndex] = createSignal(0);
    const [loading, setLoading] = createSignal(true);
    const [error, setError] = createSignal<string | null>(null);

    const selected = createMemo(() => configurations()[selectedIndex()] ?? null);
    const keybind = useKeybind();

    const move = (delta: number) => {
        const list = configurations();
        if (!list.length) return;

        setSelectedIndex((prev) => {
            const next = Math.max(0, Math.min(list.length - 1, prev + delta));
            return next;
        });
    };

    useKeyboard((evt) => {
        const name = evt.name?.toLowerCase();

        if (
            name === "up" ||
            name === "k" ||
            (evt.ctrl && name === "p")
        ) {
            move(-1);
        }

        if (
            name === "down" ||
            name === "j" ||
            (evt.ctrl && name === "n")
        ) {
            move(1);
        }

        if (name === "pageup") move(-10);
        if (name === "pagedown") move(10);

        if (name === "return") {
            const option = selected();
            if (option) {
                props.onSelect?.(option);
            }
        }

        for (const item of props.keybind ?? []) {
            if (Keybind.match(item.keybind, keybind.parse(evt))) {
                const current = selected();
                if (current) {
                    evt.preventDefault?.();
                    item.onTrigger(current);
                }
            }
        }
    });

    createEffect(() => {
        let cancelled = false;

        const load = async () => {
            setLoading(true);
            setError(null);

            try {
                const nextConfigurations = await props.client.list();
                if (cancelled) return;
                setConfigurations(nextConfigurations);
                if (nextConfigurations.length > 0) {
                    setSelectedIndex(0);
                } else {
                    setSelectedIndex(0);
                }
            } catch (err) {
                if (cancelled) return;
                const message = err instanceof Error ? err.message : String(err);
                setError(`Failed to load configurations: ${message}`);
            } finally {
                if (cancelled) return;
                setLoading(false);
            }
        };

        load();

        onCleanup(() => {
            cancelled = true;
        });
    });

    createEffect(() => {
        const listLength = configurations().length;
        if (listLength === 0) {
            setSelectedIndex(0);
        } else if (selectedIndex() >= listLength) {
            setSelectedIndex(listLength - 1);
        }
    });

    const serverLabel = () =>
        props.mode === "stub"
            ? "Stubbed backend (local fixtures)"
            : props.socketPath
            ? `Socket: ${props.socketPath}`
            : `Server: ${props.host}:${props.port}`;

    return (
        <box flexDirection="column" flexGrow={1} padding={1}>
            <text attributes={TextAttributes.BOLD}>Ori Database Explorer</text>
            <text attributes={TextAttributes.DIM}>{serverLabel()}</text>
            <box height={1} />

            {loading() ? (
                <text>Loading configurations...</text>
            ) : error() ? (
                <text fg="red">{error()}</text>
            ) : (
                <box flexDirection="column">
                    <text attributes={TextAttributes.BOLD}>Configurations:</text>
                    <box height={1} />
                    <For each={configurations()}>
                        {(configuration, index) => (
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
                                    {configuration.name} ({configuration.type}) - {configuration.host}:{configuration.port}/{configuration.database}
                                </text>
                            </box>
                        )}
                    </For>
                    <box height={1} />
                    <text attributes={TextAttributes.DIM}>
                        Use ↑/↓ arrows, j/k, Ctrl+N/P, PgUp/PgDn to navigate. Enter to select.
                    </text>
                </box>
            )}
        </box>
    );
}
