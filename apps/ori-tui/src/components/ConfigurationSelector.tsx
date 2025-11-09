import { TextAttributes } from "@opentui/core";
import { For, Show, createMemo, createSignal } from "solid-js";
import type { Configuration } from "@src/lib/configuration";
import { useClientInfo } from "@src/providers/client";
import { useConfigurations } from "@src/providers/configurations";
import {
    type ConnectionRecord,
    useConnectionState,
} from "@src/providers/connectionState";
import { useScopedKeymap } from "@src/providers/keymap";

export function ConfigurationSelector() {
    const clientInfo = useClientInfo();
    const { configurations, loading, error, refresh } = useConfigurations();
    const connectionState = useConnectionState();
    const records = connectionState.records;

    const [selectedIndex, setSelectedIndex] = createSignal(0);

    const selected = createMemo(() => configurations()[selectedIndex()] ?? null);
    const selectedRecord = createMemo<ConnectionRecord | undefined>(() => {
        const configuration = selected();
        if (!configuration) return undefined;
        return records()[configuration.name];
    });

    const serverLabel = () =>
        clientInfo.mode === "stub"
            ? "Stubbed backend (local fixtures)"
            : clientInfo.socketPath
            ? `Socket: ${clientInfo.socketPath}`
            : `Server: ${clientInfo.host ?? "localhost"}:${clientInfo.port ?? 8080}`;

    const move = (delta: number) => {
        const list = configurations();
        if (!list.length) return;
        setSelectedIndex((prev) => {
            const next = Math.max(0, Math.min(list.length - 1, prev + delta));
            return next;
        });
    };

    const isBusy = (configuration: Configuration) => {
        const record = records()[configuration.name];
        if (!record) return false;
        return record.status === "requesting" || record.status === "waiting";
    };

    const rowStatus = (configuration: Configuration) => {
        const record = records()[configuration.name];
        if (!record) return "";
        if (record.status === "waiting") return " [waiting]";
        if (record.status === "requesting") return " [connecting]";
        if (record.status === "failed") return " [failed]";
        if (record.status === "connected") return " [connected]";
        return "";
    };

    const connectBanner = createMemo(() => {
        const record = selectedRecord();
        if (!record) return null;
        if (record.status === "requesting") {
            return record.message ?? "Contacting backend...";
        }
        if (record.status === "waiting") {
            return record.message ?? "Waiting for server event...";
        }
        if (record.status === "failed") {
            return record.message ?? record.error ?? "Connection failed";
        }
        return null;
    });

    const handleSelect = () => {
        const configuration = selected();
        if (!configuration) return;
        const record = records()[configuration.name];
        if (record?.status === "connected") {
            connectionState.focus(configuration.name);
            return;
        }
        if (isBusy(configuration)) {
            return;
        }
        void connectionState.connect(configuration);
    };

    useScopedKeymap("configuration-selector", () => [
        { pattern: "up", handler: () => move(-1), preventDefault: true },
        { pattern: "k", handler: () => move(-1), preventDefault: true },
        { pattern: "ctrl+p", handler: () => move(-1), preventDefault: true },
        { pattern: "down", handler: () => move(1), preventDefault: true },
        { pattern: "j", handler: () => move(1), preventDefault: true },
        { pattern: "ctrl+n", handler: () => move(1), preventDefault: true },
        { pattern: "pageup", handler: () => move(-10), preventDefault: true },
        { pattern: "pagedown", handler: () => move(10), preventDefault: true },
        { pattern: "return", handler: handleSelect, preventDefault: true },
        { pattern: "ctrl+r", handler: () => void refresh(), preventDefault: true },
    ]);

    return (
        <box flexDirection="column" flexGrow={1} padding={1}>
            <text attributes={TextAttributes.BOLD}>Ori Database Explorer</text>
            <text attributes={TextAttributes.DIM}>{serverLabel()}</text>
            <box height={1} />

            <Show when={!loading()} fallback={<text>Loading configurations...</text>}>
                <Show
                    when={!error()}
                    fallback={<text fg="red">Failed to load configurations: {error()}</text>}
                >
                    <box flexDirection="column">
                        <text attributes={TextAttributes.BOLD}>Configurations:</text>
                        <box height={1} />
                        <For each={configurations()}>
                            {(configuration, index) => (
                                <box flexDirection="row">
                                    <text
                                        fg={index() === selectedIndex() ? "cyan" : undefined}
                                        attributes=
                                            {index() === selectedIndex()
                                                ? TextAttributes.BOLD
                                                : TextAttributes.NONE}
                                    >
                                        {index() === selectedIndex() ? "> " : "  "}
                                        {configuration.name} ({configuration.type}) -
                                        {" "}
                                        {configuration.host}:{configuration.port}/
                                        {configuration.database}
                                        {rowStatus(configuration)}
                                    </text>
                                </box>
                            )}
                        </For>
                        <Show when={connectBanner()}>
                            {(message) => (
                                <>
                                    <box height={1} />
                                    <text fg="yellow">{message()}</text>
                                </>
                            )}
                        </Show>
                        <box height={1} />
                        <text attributes={TextAttributes.DIM}>
                            Use ↑/↓ arrows, j/k, Ctrl+N/P, PgUp/PgDn to navigate. Enter to connect or
                            focus existing sessions.
                        </text>
                    </box>
                </Show>
            </Show>
        </box>
    );
}
