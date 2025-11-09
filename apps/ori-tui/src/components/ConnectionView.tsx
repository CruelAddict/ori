import { TextAttributes } from "@opentui/core";
import { For, Show, createMemo } from "solid-js";
import { useGraphSnapshot } from "@src/lib/useGraphSnapshot";
import { useSchemaTree } from "@src/lib/schemaTree";
import { useScopedKeymap } from "@src/providers/keymap";
import { useConfigurationByName } from "@src/providers/configurations";

export interface ConnectionViewProps {
    configurationName: string;
    onBack: () => void;
}

export function ConnectionView(props: ConnectionViewProps) {
    const configuration = useConfigurationByName(() => props.configurationName);
    const { snapshot, loading, error, refresh } = useGraphSnapshot(() => props.configurationName);
    const tree = useSchemaTree(snapshot);

    const title = createMemo(() => configuration()?.name ?? props.configurationName);

    const handleExit = () => {
        props.onBack();
    };

    useScopedKeymap("connection-view", () => [
        { pattern: "escape", handler: handleExit, preventDefault: true },
        { pattern: "backspace", handler: handleExit, preventDefault: true },
        { pattern: "ctrl+[", handler: handleExit, preventDefault: true },
        { pattern: "down", handler: () => tree.moveSelection(1), preventDefault: true },
        { pattern: "j", handler: () => tree.moveSelection(1), preventDefault: true },
        { pattern: "up", handler: () => tree.moveSelection(-1), preventDefault: true },
        { pattern: "k", handler: () => tree.moveSelection(-1), preventDefault: true },
        { pattern: "right", handler: () => tree.focusFirstChild(), preventDefault: true },
        { pattern: "l", handler: () => tree.focusFirstChild(), preventDefault: true },
        { pattern: "left", handler: () => tree.collapseCurrentOrParent(), preventDefault: true },
        { pattern: "h", handler: () => tree.collapseCurrentOrParent(), preventDefault: true },
        { pattern: "ctrl+r", handler: () => void refresh(), preventDefault: true },
    ]);

    return (
        <box flexDirection="column" flexGrow={1} padding={1}>
            <text attributes={TextAttributes.BOLD}>Connection</text>
            <text attributes={TextAttributes.DIM}>{title()}</text>
            <box height={1} />

            <Show when={loading()}>
                <text>Loading schema graph...</text>
            </Show>
            <Show when={!loading() && error()}>
                {(message) => <text fg="red">Failed to load graph: {message()}</text>}
            </Show>
            <Show when={!loading() && !error()}>
                <box flexDirection="column">
                    <For each={tree.rows()}>
                        {(row) => {
                            const isSelected = () => tree.selectedId() === row.id;
                            const toggleGlyph = row.entity.hasChildren
                                ? row.isExpanded
                                    ? "[-]"
                                    : "[+]"
                                : "   ";
                            const fg = () => (isSelected() ? "cyan" : undefined);
                            const attrs = () => (isSelected() ? TextAttributes.BOLD : TextAttributes.NONE);
                            return (
                                <box flexDirection="row" paddingLeft={row.depth * 2}>
                                    <text fg={fg()} attributes={attrs()}>
                                        {isSelected() ? "> " : "  "}
                                        {toggleGlyph} {row.entity.icon} {row.entity.label}
                                    </text>
                                    {row.entity.description && (
                                        <text attributes={TextAttributes.DIM}> {row.entity.description}</text>
                                    )}
                                    {row.entity.badges && <text fg="cyan"> {row.entity.badges}</text>}
                                </box>
                            );
                        }}
                    </For>
                    <Show when={tree.rows().length === 0}>
                        <text attributes={TextAttributes.DIM}>Graph is empty. Try refreshing later.</text>
                    </Show>
                </box>
            </Show>

            <box height={1} />
            <text attributes={TextAttributes.DIM}>
                Navigate with ↑/↓ or j/k. Use ←/h to collapse, →/l to dive in. Esc returns. Ctrl+R refreshes.
            </text>
        </box>
    );
}
