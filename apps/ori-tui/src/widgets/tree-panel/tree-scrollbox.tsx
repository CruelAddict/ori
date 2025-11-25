import { createContext, createEffect, onCleanup, useContext, type Accessor, type ParentProps } from "solid-js";
import type { BoxRenderable, ScrollBoxRenderable } from "@opentui/core";
import { createAutoscrollService } from "./tree-scroll/autoscroll-service.ts";
import { createOverflowTracker } from "./tree-scroll/overflow-tracker.ts";
import { createRowMetrics, type MeasureRowWidth, type RowDescriptor } from "./tree-scroll/row-metrics.ts";
import type { ScrollDelta } from "./tree-scroll/types.ts";

interface TreeScrollManager {
    setScrollBox(node: ScrollBoxRenderable | undefined): void;
    registerRowNode(rowId: string, node: BoxRenderable | undefined): void;
    syncRows(rows: readonly RowDescriptor[]): void;
    ensureRowVisible(rowId: string | null): void;
    scrollBy(delta: ScrollDelta): void;
    contentWidth: () => number;
    naturalContentWidth: () => number;
    setMinimumVisibleWidth(width: number): void;
    refreshOverflowState(): void;
    horizontalOverflow: () => boolean;
    dispose(): void;
}

function createTreeScrollManager(measureRowWidth: MeasureRowWidth): TreeScrollManager {
    let scrollBox: ScrollBoxRenderable | undefined;
    let overflowTrackerRef: ReturnType<typeof createOverflowTracker> | null = null;

    const autoscroll = createAutoscrollService();
    const rowMetrics = createRowMetrics(measureRowWidth, (contentWidth: number) => {
        applyContentWidth(contentWidth);
    });
    const overflowTracker = createOverflowTracker({
        getNaturalWidth: rowMetrics.naturalWidth,
        requestHorizontalReset: autoscroll.requestHorizontalReset,
        hasPendingHorizontalReset: autoscroll.hasPendingHorizontalReset,
    });
    overflowTrackerRef = overflowTracker;

    function applyContentWidth(width: number) {
        if (!scrollBox) {
            overflowTrackerRef?.refresh();
            return;
        }
        scrollBox.content.minWidth = width;
        scrollBox.content.width = width;
        scrollBox.content.maxWidth = width;
        scrollBox.content.flexGrow = 0;
        scrollBox.content.flexShrink = 0;
        scrollBox.requestRender();
        overflowTrackerRef?.refresh();
    }

    const setScrollBox = (node: ScrollBoxRenderable | undefined) => {
        scrollBox = node;
        autoscroll.setScrollBox(node);
        overflowTracker.setScrollBox(node);
        if (!scrollBox) {
            return;
        }
        applyContentWidth(rowMetrics.contentWidth());
    };

    const registerRowNode = (rowId: string, node: BoxRenderable | undefined) => {
        autoscroll.registerRowNode(rowId, node);
    };

    const syncRows = (rows: readonly RowDescriptor[]) => {
        rowMetrics.syncRows(rows);
    };

    const ensureRowVisible = (rowId: string | null) => {
        autoscroll.ensureRowVisible(rowId);
    };

    const scrollBy = (delta: ScrollDelta) => {
        autoscroll.scrollBy(delta);
    };

    const setMinimumVisibleWidth = (width: number) => {
        rowMetrics.setMinimumVisibleWidth(width);
    };

    const refreshOverflowState = () => {
        overflowTracker.refresh();
    };

    const dispose = () => {
        rowMetrics.dispose();
        autoscroll.dispose();
        overflowTracker.dispose();
        scrollBox = undefined;
    };

    return {
        setScrollBox,
        registerRowNode,
        syncRows,
        ensureRowVisible,
        scrollBy,
        contentWidth: rowMetrics.contentWidth,
        naturalContentWidth: rowMetrics.naturalWidth,
        setMinimumVisibleWidth,
        refreshOverflowState,
        horizontalOverflow: overflowTracker.horizontalOverflow,
        dispose,
    };
}

interface TreeScrollboxContextValue {
    registerRowNode: TreeScrollManager["registerRowNode"];
}

const TreeScrollboxContext = createContext<TreeScrollboxContextValue | null>(null);

export function useTreeScrollRegistration() {
    const ctx = useContext(TreeScrollboxContext);
    if (!ctx) throw new Error("useTreeScrollRegistration must be used within a TreeScrollbox");
    return ctx.registerRowNode;
}

export interface TreeScrollboxApi {
    scrollBy(delta: ScrollDelta): void;
}

interface TreeScrollboxProps extends ParentProps {
    rows: Accessor<readonly RowDescriptor[]>;
    measureRowWidth: MeasureRowWidth;
    selectedRowId: Accessor<string | null>;
    terminalWidth: Accessor<number>;
    isFocused: Accessor<boolean>;
    onApiReady?: (api: TreeScrollboxApi | undefined) => void;
    onNaturalWidthChange?: (width: number) => void;
}

export function TreeScrollbox(props: TreeScrollboxProps) {
    const treeScroll = createTreeScrollManager(props.measureRowWidth);

    props.onApiReady?.({ scrollBy: treeScroll.scrollBy });
    onCleanup(() => {
        props.onApiReady?.(undefined);
        treeScroll.dispose();
    });

    createEffect(() => {
        treeScroll.syncRows(props.rows());
    });

    createEffect(() => {
        props.rows();
        treeScroll.ensureRowVisible(props.selectedRowId());
    });

    createEffect(() => {
        treeScroll.setMinimumVisibleWidth(props.terminalWidth());
    });

    createEffect(() => {
        props.rows();
        props.terminalWidth();
        props.isFocused();
        props.selectedRowId();
        treeScroll.refreshOverflowState();
    });

    createEffect(() => {
        props.onNaturalWidthChange?.(treeScroll.naturalContentWidth());
    });

    const handleScrollboxRef = (node: ScrollBoxRenderable | undefined) => {
        treeScroll.setScrollBox(node);
    };

    const contextValue: TreeScrollboxContextValue = {
        registerRowNode: treeScroll.registerRowNode,
    };

    return (
        <scrollbox
            ref={handleScrollboxRef}
            flexDirection="column"
            flexGrow={1}
            height="100%"
            scrollbarOptions={{ visible: false }}
            horizontalScrollbarOptions={{ visible: treeScroll.horizontalOverflow() }}
            scrollY={true}
            scrollX={true}
        >
            <TreeScrollboxContext.Provider value={contextValue}>
                <box flexDirection="column" width={treeScroll.contentWidth()} flexShrink={0} alignItems="flex-start">
                    {props.children}
                </box>
            </TreeScrollboxContext.Provider>
        </scrollbox>
    );
}

export type { RowDescriptor, MeasureRowWidth, ScrollDelta };
