import { For, Show, createEffect, createMemo, createSelector, createSignal, onCleanup, onMount, type Accessor } from "solid-js";
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import type { BoxRenderable } from "@opentui/core";
import { KeyScope, type KeyBinding } from "@src/core/services/key-scopes";
import type { TreePaneViewModel } from "@src/features/tree-pane/use-tree-pane";
import { useTheme } from "@app/providers/theme";
import { createTreeScrollManager, type RowDescriptor } from "./tree-scroll";

const TREE_SCOPE_ID = "connection-view.tree";
const ROW_ID_PREFIX = "tree-row-";
const HORIZONTAL_SCROLL_STEP = 6;
const MIN_FOCUSED_COLUMN_WIDTH = 40;
const MIN_FOCUSED_PERCENT = 0.2;
const MAX_FOCUSED_PERCENT = 0.5;

export interface TreePanelProps {
    viewModel: TreePaneViewModel;
}

export function TreePanel(props: TreePanelProps) {
    const pane = props.viewModel;
    const rootIds = pane.controller.rootIds;
    const rows = pane.controller.visibleRows;
    const selectedId = pane.controller.selectedId;
    const isRowSelected = createSelector(selectedId);
    const { theme } = useTheme();
    const palette = theme;

    // Width calc cache keyed by row id+depth; descriptor object identity isn't stable in recursive rendering
    const rowWidthCache = new Map<string, number>();
    const keyOf = (row: RowDescriptor) => {
        const expanded = pane.controller.isExpanded(row.id) ? 1 : 0;
        return `${row.id}@${row.depth}:${expanded}`;
    };
    const calculateRowWidth = (row: RowDescriptor) => {
        const entity = pane.controller.getEntity(row.id);
        const hasChildren = Boolean(entity?.hasChildren);
        const isExpanded = pane.controller.isExpanded(row.id);
        const glyph = hasChildren ? (isExpanded ? "[-]" : "[+]") : "   ";
        const indicator = "> ";
        const icon = entity?.icon ? `${entity.icon}` : "";
        let width = row.depth * 2;
        const baseLabel = entity?.label ?? "";
        const base = `${indicator}${glyph} ${icon} ${baseLabel}`;
        width += base.length;
        if (entity?.description) width += 1 + entity.description.length;
        if (entity?.badges) width += 1 + entity.badges.length;
        return width;
    };
    const getRowWidth = (row: RowDescriptor) => {
        const k = keyOf(row);
        const cached = rowWidthCache.get(k);
        if (cached !== undefined) return cached;
        const width = calculateRowWidth(row);
        rowWidthCache.set(k, width);
        return width;
    };
    const treeScroll = createTreeScrollManager(getRowWidth);

    const [terminalWidth, setTerminalWidth] = createSignal(readTerminalWidth());
    const formatPercent = (fraction: number) => `${Math.round(fraction * 100)}%` as `${number}%`;
    const [focusedWidthFraction, setFocusedWidthFraction] = createSignal(MAX_FOCUSED_PERCENT);
    const focusedWidthPercent = createMemo(() => formatPercent(focusedWidthFraction()));
    const focusedMinWidth = createMemo(() => {
        const terminal = terminalWidth();
        if (terminal <= 0) return MIN_FOCUSED_COLUMN_WIDTH;
        return Math.max(MIN_FOCUSED_COLUMN_WIDTH, Math.floor(focusedWidthFraction() * terminal));
    });
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
        const delta = direction === "left" ? -HORIZONTAL_SCROLL_STEP : HORIZONTAL_SCROLL_STEP;
        treeScroll.scrollBy({ x: delta, y: 0 });
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
        { pattern: "enter", handler: () => pane.controller.activateSelection(), preventDefault: true },
        { pattern: "space", handler: () => pane.controller.activateSelection(), preventDefault: true },
    ];

    const enabled = () => pane.visible() && pane.isFocused();

    // Sync scroll manager with the navigation rows; this doesn't trigger UI re-rendering itself
    createEffect(() => {
        treeScroll.syncRows(rows());
    });

    // Keep selected row visible on updates
    createEffect(() => {
        if (!pane.visible()) return;
        rows();
        treeScroll.ensureRowVisible(pane.controller.selectedId());
    });

    // Re-evaluate overflow when layout/visibility changes
    createEffect(() => {
        if (!pane.visible()) return;
        rows();
        terminalWidth();
        pane.isFocused();
        pane.controller.selectedId();
        treeScroll.refreshOverflowState();
    });

    createEffect(() => {
        treeScroll.setMinimumVisibleWidth(terminalWidth());
    });

    createEffect(() => {
        const terminal = terminalWidth();
        if (terminal <= 0) {
            setFocusedWidthFraction(MAX_FOCUSED_PERCENT);
            return;
        }
        const naturalWidth = treeScroll.naturalContentWidth();
        const ratio = Math.min(1, Math.max(0, naturalWidth / terminal));
        const baseFraction = MIN_FOCUSED_PERCENT + (MAX_FOCUSED_PERCENT - MIN_FOCUSED_PERCENT) * ratio;
        const minFractionFromColumns = MIN_FOCUSED_COLUMN_WIDTH / terminal;
        const nextFraction = Math.max(MIN_FOCUSED_PERCENT, baseFraction, minFractionFromColumns);
        setFocusedWidthFraction(Math.min(MAX_FOCUSED_PERCENT, nextFraction));
    });

    const paneWidthProps = () => {
        if (pane.isFocused()) {
            return {
                width: "auto" as const,
                maxWidth: focusedWidthPercent(),
                minWidth: focusedMinWidth(),
                flexGrow: 1,
            };
        }
        return { width: MIN_FOCUSED_COLUMN_WIDTH, maxWidth: MIN_FOCUSED_COLUMN_WIDTH, minWidth: MIN_FOCUSED_COLUMN_WIDTH, flexGrow: 0 } as const;
    };

    interface TreeNodeProps { nodeId: string; depth: number }

    const TreeNode = (nodeProps: TreeNodeProps) => {
        const entity = createMemo(() => pane.controller.getEntity(nodeProps.nodeId));
        const childIds = createMemo(() => pane.controller.getRenderableChildIds(nodeProps.nodeId));
        const rowId = () => nodeProps.nodeId;
        const isExpanded = () => pane.controller.isExpanded(nodeProps.nodeId);
        const isSelected = () => isRowSelected(rowId());
        const [childrenMounted, setChildrenMounted] = createSignal(false);
        createEffect(() => { if (isExpanded()) setChildrenMounted(true); });
        const fg = () => (isSelected() ? palette().primary : palette().text);
        const attrs = () => (isSelected() ? TextAttributes.BOLD : TextAttributes.NONE);
        const toggleGlyph = () => {
            const details = entity();
            if (!details?.hasChildren) return "   ";
            return isExpanded() ? "[-]" : "[+]";
        };
        const descriptor = createMemo<RowDescriptor>(() => ({ id: rowId(), depth: nodeProps.depth }));
        return (
            <Show when={entity()}>
                {(detailsAccessor: Accessor<ReturnType<typeof entity>>) => {
                    const details = () => detailsAccessor()!;
                    return (
                        <>
                            <box
                                id={rowElementId(rowId())}
                                flexDirection="row"
                                paddingLeft={nodeProps.depth * 2}
                                width={getRowWidth(descriptor())}
                                flexShrink={0}
                                ref={(node: BoxRenderable | undefined) => treeScroll.registerRowNode(rowId(), node)}
                            >
                                <text fg={fg()} attributes={attrs()} wrapMode="none">
                                    {isSelected() ? "> " : "  "}
                                    {toggleGlyph()} {details().icon} {details().label}
                                </text>
                                {details().description && (
                                    <text attributes={TextAttributes.DIM} fg={palette().textMuted} wrapMode="none">
                                        {" "}
                                        {details().description}
                                    </text>
                                )}
                                {details().badges && (
                                    <text fg={palette().accent} wrapMode="none">
                                        {" "}
                                        {details().badges}
                                    </text>
                                )}
                            </box>
                            <Show when={childrenMounted()}>
                                <box flexDirection="column" visible={isExpanded()}>
                                    <For each={childIds()}>{(childId) => (<TreeNode nodeId={childId} depth={nodeProps.depth + 1} />)}</For>
                                </box>
                            </Show>
                        </>
                    );
                }}
            </Show>
        );
    };

    return (
        <Show when={pane.visible()}>
            <KeyScope id={TREE_SCOPE_ID} bindings={bindings} enabled={enabled}>
                <box
                    flexDirection="column"
                    {...paneWidthProps()}
                    height="100%"
                    flexShrink={0}
                    borderStyle="single"
                    borderColor={pane.isFocused() ? palette().primary : palette().border}
                    backgroundColor={palette().backgroundPanel}
                >
                    <box padding={1} flexDirection="column" flexGrow={1} height="100%">
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
                                ref={(node: ScrollBoxRenderable | undefined) => treeScroll.setScrollBox(node)}
                                flexDirection="column"
                                flexGrow={1}
                                height="100%"
                                scrollbarOptions={{ visible: false }}
                                horizontalScrollbarOptions={{ visible: treeScroll.horizontalOverflow() }}
                                scrollY={true}
                                scrollX={true}
                            >
                                <box flexDirection="column" width={treeScroll.contentWidth()} flexShrink={0} alignItems="flex-start">
                                    <Show
                                        when={rootIds().length > 0}
                                        fallback={
                                            <text attributes={TextAttributes.DIM} fg={palette().textMuted}>
                                                Graph is empty. Try refreshing later.
                                            </text>
                                        }
                                    >
                                        <For each={rootIds()}>{(id) => <TreeNode nodeId={id} depth={0} />}</For>
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

function readTerminalWidth() {
    if (typeof process === "undefined") return 0;
    const columns = process.stdout?.columns;
    return columns ?? 0;
}
