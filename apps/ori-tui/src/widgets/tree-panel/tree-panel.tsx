import { For, Show, type Accessor } from "solid-js";
import { TextAttributes } from "@opentui/core";
import { KeyScope, type KeyBinding } from "@src/core/services/key-scopes";
import type { TreePaneViewModel } from "@src/features/tree-pane/use-tree-pane";

const TREE_SCOPE_ID = "connection-view.tree";

export interface TreePanelProps {
    viewModel: TreePaneViewModel;
}

export function TreePanel(props: TreePanelProps) {
    const pane = props.viewModel;
    const rows = pane.controller.rows;
    const selectedId = pane.controller.selectedId;

    const moveSelection = (delta: number) => {
        pane.controller.moveSelection(delta);
    };

    const bindings: KeyBinding[] = [
        { pattern: "down", handler: () => moveSelection(1), preventDefault: true },
        { pattern: "j", handler: () => moveSelection(1), preventDefault: true },
        { pattern: "up", handler: () => moveSelection(-1), preventDefault: true },
        { pattern: "k", handler: () => moveSelection(-1), preventDefault: true },
        { pattern: "right", handler: () => pane.controller.focusFirstChild(), preventDefault: true },
        { pattern: "l", handler: () => pane.controller.focusFirstChild(), preventDefault: true },
        { pattern: "left", handler: () => pane.controller.collapseCurrentOrParent(), preventDefault: true },
        { pattern: "h", handler: () => pane.controller.collapseCurrentOrParent(), preventDefault: true },
    ];

    const enabled = () => pane.visible() && pane.isFocused();

    return (
        <Show when={pane.visible()}>
            <KeyScope id={TREE_SCOPE_ID} bindings={bindings} enabled={enabled}>
                <box
                    flexDirection="column"
                    width={40}
                    flexShrink={0}
                    borderStyle="single"
                    borderColor={pane.isFocused() ? "cyan" : "gray"}
                >
                    <box padding={1} flexDirection="column" flexGrow={1}>
                        <Show when={pane.loading()}>
                            <text>Loading schema graph...</text>
                        </Show>
                        <Show when={!pane.loading() && pane.error()}>
                            {(message: Accessor<string | null>) => (
                                <text fg="red">Failed to load graph: {message()}</text>
                            )}
                        </Show>
                        <Show when={!pane.loading() && !pane.error()}>
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
            </KeyScope>
        </Show>
    );
}
