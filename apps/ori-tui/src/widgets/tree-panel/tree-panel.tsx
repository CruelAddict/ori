import { For, Show, createEffect, createSelector, createSignal, onCleanup, onMount, type Accessor } from "solid-js";
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import type { BoxRenderable } from "@opentui/core";
import { KeyScope, type KeyBinding } from "@src/core/services/key-scopes";
import type { TreePaneViewModel } from "@src/features/tree-pane/use-tree-pane";
import { useTheme } from "@app/providers/theme";
import type { TreeRow } from "@entities/schema-tree";

const TREE_SCOPE_ID = "connection-view.tree";
const ROW_ID_PREFIX = "tree-row-";
const HORIZONTAL_SCROLL_STEP = 6;

export interface TreePanelProps {
    viewModel: TreePaneViewModel;
}

export function TreePanel(props: TreePanelProps) {
    const pane = props.viewModel;
    const rows = pane.controller.rows;
    const selectedId = pane.controller.selectedId;
    const isRowSelected = createSelector(selectedId);
    const { theme } = useTheme();
    const palette = theme;
    let scrollRef: ScrollBoxRenderable | undefined;
    const rowNodes = new Map<string, BoxRenderable>();
    const rowWidthCache = new WeakMap<TreeRow, number>();

    const registerRowNode = (rowId: string, node: BoxRenderable | undefined) => {
        if (!node) {
            rowNodes.delete(rowId);
            return;
        }
        rowNodes.set(rowId, node);
    };

    const getRowWidth = (row: TreeRow) => {
        const cached = rowWidthCache.get(row);
        if (cached !== undefined) {
            return cached;
        }
        const width = calculateRowWidth(row);
        rowWidthCache.set(row, width);
        return width;
    };

    const [terminalWidth, setTerminalWidth] = createSignal(readTerminalWidth());
    const handleResize = () => setTerminalWidth(readTerminalWidth());

    onMount(() => {
        handleResize();
        process.stdout?.on?.("resize", handleResize);
    });

    onCleanup(() => {
        process.stdout?.off?.("resize", handleResize);
    });

    const moveSelection = (delta: number) => {
        pane.controller.moveSelection(delta);
    };

    const handleManualHorizontalScroll = (direction: "left" | "right") => {
        if (!scrollRef) return;
        const delta = direction === "left" ? -HORIZONTAL_SCROLL_STEP : HORIZONTAL_SCROLL_STEP;
        scrollRef.scrollBy({ x: delta, y: 0 });
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
        { pattern: "ctrl+h", handler: () => handleManualHorizontalScroll("left"), preventDefault: true },
        { pattern: "ctrl+l", handler: () => handleManualHorizontalScroll("right"), preventDefault: true },
    ];

    const enabled = () => pane.visible() && pane.isFocused();

    createEffect(() => {
        const currentRows = rows();
        const validIds = new Set(currentRows.map((row) => row.id));
        for (const id of Array.from(rowNodes.keys())) {
            if (!validIds.has(id)) {
                rowNodes.delete(id);
            }
        }
    });

    createEffect(() => {
        if (!pane.visible()) return;
        rows();
        terminalWidth();
        pane.isFocused();
        pane.controller.selectedId();
    });

    const paneWidthProps = () => {
        if (pane.isFocused()) {
            return {
                width: "auto" as const,
                maxWidth: "50%" as const,
                minWidth: 40,
                flexGrow: 1,
            };
        }
        return {
            width: 40,
            maxWidth: 40,
            minWidth: 40,
            flexGrow: 0,
        };
    };

    return (
        <Show when={pane.visible()}>
            <KeyScope id={TREE_SCOPE_ID} bindings={bindings} enabled={enabled}>
                <box
                    flexDirection="column"
                    {...paneWidthProps()}
                    flexShrink={0}
                    borderStyle="single"
                    borderColor={pane.isFocused() ? palette().primary : palette().border}
                    backgroundColor={palette().backgroundPanel}
                >
                    <box padding={1} flexDirection="column" flexGrow={1}>
                        <Show when={pane.loading()}>
                            <text fg={palette().text}>Loading schema graph...</text>
                        </Show>
                        <Show when={!pane.loading() && pane.error()}>
                            {(message: Accessor<string | null>) => (
                                <text fg={palette().error}>Failed to load graph: {message()}</text>
                            )}
                        </Show>
                        <Show when={!pane.loading() && !pane.error()}>
                            <scrollbox
                                ref={(node: ScrollBoxRenderable | undefined) => {
                                    scrollRef = node;
                                }}
                                flexDirection="column"
                                flexGrow={1}
                                scrollbarOptions={{ visible: false }}
                                horizontalScrollbarOptions={{ visible: false }}
                                scrollY={true}
                                scrollX={true}
                            >
                                <box flexDirection="column">
                                    <For each={rows()}>
                                        {(row) => {
                                            const isSelected = () => isRowSelected(row.id);
                                            const toggleGlyph = row.entity.hasChildren
                                                ? row.isExpanded
                                                    ? "[-]"
                                                    : "[+]"
                                                : "   ";
                                            const fg = () => (isSelected() ? palette().primary : palette().text);
                                            const attrs = () => (isSelected() ? TextAttributes.BOLD : TextAttributes.NONE);
                                            return (
                                                <box
                                                    id={rowElementId(row.id)}
                                                    flexDirection="row"
                                                    paddingLeft={row.depth * 2}
                                                    width={getRowWidth(row)}
                                                    flexShrink={0}
                                                    ref={(node: BoxRenderable | undefined) => registerRowNode(row.id, node)}
                                                >
                                                    <text fg={fg()} attributes={attrs()} wrapMode="none">
                                                        {isSelected() ? "> " : "  "}
                                                        {toggleGlyph} {row.entity.icon} {row.entity.label}
                                                    </text>
                                                    {row.entity.description && (
                                                        <text attributes={TextAttributes.DIM} fg={palette().textMuted} wrapMode="none">
                                                            {" "}
                                                            {row.entity.description}
                                                        </text>
                                                    )}
                                                    {row.entity.badges && (
                                                        <text fg={palette().accent} wrapMode="none">
                                                            {" "}
                                                            {row.entity.badges}
                                                        </text>
                                                    )}
                                                </box>
                                            );
                                        }}
                                    </For>
                                    <Show when={rows().length === 0}>
                                        <text attributes={TextAttributes.DIM} fg={palette().textMuted}>
                                            Graph is empty. Try refreshing later.
                                        </text>
                                    </Show>
                                </box>
                            </scrollbox>
                        </Show>
                    </box>
                </box>
            </KeyScope>
        </Show>
    );
}

function rowElementId(rowId: string) {
    return `${ROW_ID_PREFIX}${rowId}`;
}

function calculateRowWidth(row: TreeRow) {
    const glyph = row.entity.hasChildren ? (row.isExpanded ? "[-]" : "[+]") : "   ";
    const indicator = "> ";
    const icon = row.entity.icon ? `${row.entity.icon}` : "";
    let width = row.depth * 2;
    const base = `${indicator}${glyph} ${icon} ${row.entity.label}`;
    width += base.length;
    if (row.entity.description) {
        width += 1 + row.entity.description.length;
    }
    if (row.entity.badges) {
        width += 1 + row.entity.badges.length;
    }
    return width;
}

function readTerminalWidth() {
    if (typeof process === "undefined") {
        return 0;
    }
    const columns = process.stdout?.columns;
    return columns ?? 0;
}
