import { useTheme } from "@app/providers/theme";
import { TextAttributes } from "@opentui/core";
import { type KeyBinding, KeyScope } from "@src/core/services/key-scopes";
import type { TreePaneViewModel } from "@src/features/tree-pane/use-tree-pane";
import {
    type Accessor,
    createEffect,
    createMemo,
    createSelector,
    createSignal,
    For,
    onCleanup,
    onMount,
    Show,
} from "solid-js";
import { createTreeNodeMetrics, TreeNode } from "./tree-node.tsx";
import { MIN_CONTENT_WIDTH } from "./tree-scroll/row-metrics.ts";
import { TreeScrollbox, type TreeScrollboxApi } from "./tree-scrollbox.tsx";

const TREE_SCOPE_ID = "connection-view.tree";
const HORIZONTAL_SCROLL_STEP = 6;
const MIN_FOCUSED_COLUMN_WIDTH = 50;
const MIN_FOCUSED_PERCENT = 0.2;
const MAX_FOCUSED_PERCENT = 0.5;
const FOCUSED_WIDTH_PADDING = 5;

export type TreePanelProps = {
    viewModel: TreePaneViewModel;
};

export function TreePanel(props: TreePanelProps) {
    const pane = props.viewModel;
    const rootIds = pane.controller.rootIds;
    const rows = pane.controller.visibleRows;
    const selectedId = pane.controller.selectedId;
    const isRowSelected = createSelector(selectedId);
    const { theme } = useTheme();
    const palette = theme;

    const measureRowWidth = createTreeNodeMetrics({
        getEntity: pane.controller.getEntity,
        isExpanded: pane.controller.isExpanded,
    });
    const [treeNaturalWidth, setTreeNaturalWidth] = createSignal(MIN_CONTENT_WIDTH);
    let treeScrollboxApi: TreeScrollboxApi | null = null;
    const handleScrollboxApi = (api?: TreeScrollboxApi) => {
        treeScrollboxApi = api ?? null;
    };
    const handleNaturalWidthChange = (width: number) => {
        setTreeNaturalWidth(width);
    };

    const [terminalWidth, setTerminalWidth] = createSignal(readTerminalWidth());
    const handleResize = () => setTerminalWidth(readTerminalWidth());

    const focusedPaneWidth = createMemo(() => {
        const natural = treeNaturalWidth() + FOCUSED_WIDTH_PADDING;
        const terminal = terminalWidth();
        if (terminal <= 0) return natural;
        const minWidth = Math.max(MIN_FOCUSED_COLUMN_WIDTH, terminal * MIN_FOCUSED_PERCENT);
        const maxWidth = Math.max(minWidth, terminal * MAX_FOCUSED_PERCENT);
        const bounded = Math.min(natural, maxWidth);
        return Math.floor(Math.max(minWidth, bounded));
    });

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
        treeScrollboxApi?.scrollBy({ x: delta, y: 0 });
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

    const paneWidthProps = () => {
        if (pane.isFocused()) {
            const width = focusedPaneWidth();
            return {
                width,
                minWidth: width,
                maxWidth: width,
                flexGrow: 0,
                flexShrink: 0,
            } as const;
        }
        return {
            width: MIN_FOCUSED_COLUMN_WIDTH,
            maxWidth: MIN_FOCUSED_COLUMN_WIDTH,
            minWidth: MIN_FOCUSED_COLUMN_WIDTH,
            flexGrow: 0,
            flexShrink: 0,
        } as const;
    };

    return (
        <Show when={pane.visible()}>
            <KeyScope
                id={TREE_SCOPE_ID}
                bindings={bindings}
                enabled={enabled}
            >
                <box
                    flexDirection="column"
                    {...paneWidthProps()}
                    height="100%"
                    flexShrink={0}
                >
                    <box
                        padding={1}
                        flexDirection="column"
                        flexGrow={1}
                        height="100%"
                        border={["right"]}
                        borderColor={palette().backgroundElement}
                    >
                        <Show when={pane.loading()}>
                            <text fg={palette().text}>Loading schema graph...</text>
                        </Show>
                        <Show when={!pane.loading() && pane.error()}>
                            {(message: Accessor<string | null>) => (
                                <text fg={palette().error}>Failed to load graph: {message()}</text>
                            )}
                        </Show>
                        <Show when={!pane.loading() && !pane.error()}>
                            <TreeScrollbox
                                rows={rows}
                                measureRowWidth={measureRowWidth}
                                selectedRowId={selectedId}
                                isFocused={pane.isFocused}
                                onApiReady={handleScrollboxApi}
                                onNaturalWidthChange={handleNaturalWidthChange}
                            >
                                <Show
                                    when={rootIds().length > 0}
                                    fallback={
                                        <text
                                            attributes={TextAttributes.DIM}
                                            fg={palette().textMuted}
                                            selectable={false}
                                        >
                                            Graph is empty. Try refreshing later.
                                        </text>
                                    }
                                >
                                    <For each={rootIds()}>
                                        {(id) => (
                                            <TreeNode
                                                nodeId={id}
                                                depth={0}
                                                isFocused={pane.isFocused}
                                                pane={pane}
                                                isRowSelected={isRowSelected}
                                            />
                                        )}
                                    </For>
                                </Show>
                            </TreeScrollbox>
                        </Show>
                    </box>
                </box>
            </KeyScope>
        </Show>
    );
}

function readTerminalWidth() {
    if (typeof process === "undefined") return 0;
    const columns = process.stdout?.columns;
    return columns ?? 0;
}
