import { TextAttributes } from "@opentui/core";
import { For, Show, type Accessor } from "solid-js";
import type { SchemaTreeController } from "@src/lib/schema-tree";

export interface SchemaTreePaneProps {
    controller: SchemaTreeController;
    loading: Accessor<boolean>;
    error: Accessor<string | null>;
    focused: boolean;
    width?: number;
}

export function SchemaTreePane(props: SchemaTreePaneProps) {
    const rows = props.controller.rows;
    const selectedId = props.controller.selectedId;

    return (
        <box
            flexDirection="column"
            width={props.width ?? 40}
            flexShrink={0}
            borderStyle="single"
            borderColor={props.focused ? "cyan" : "gray"}
        >
            <box padding={1} flexDirection="column" flexGrow={1}>
                <Show when={props.loading()}>
                    <text>Loading schema graph...</text>
                </Show>
                <Show when={!props.loading() && props.error()}>
                    {(message: Accessor<string | null>) => <text fg="red">Failed to load graph: {message()}</text>}
                </Show>
                <Show when={!props.loading() && !props.error()}>
                    <box flexDirection="column">
                        <For each={rows()}>
                            {(row) => {
                                const isSelected = () => selectedId() === row.id;
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
                        <Show when={rows().length === 0}>
                            <text attributes={TextAttributes.DIM}>Graph is empty. Try refreshing later.</text>
                        </Show>
                    </box>
                </Show>
            </box>
        </box>
    );
}
