import { createContext, createEffect, onCleanup, useContext, type Accessor, type ParentProps } from "solid-js";
import type { BoxRenderable, ScrollBoxRenderable } from "@opentui/core";
import { createAutoscrollService } from "./tree-scroll/autoscroll-service.ts";
import { createOverflowTracker } from "./tree-scroll/overflow-tracker.ts";
import { createRowMetrics, type MeasureRowWidth, type RowDescriptor } from "./tree-scroll/row-metrics.ts";
import type { ScrollDelta } from "./tree-scroll/types.ts";

interface TreeScrollboxContextValue {
    registerRowNode: (rowId: string, node: BoxRenderable | undefined) => void;
}

const TreeScrollboxContext = createContext<TreeScrollboxContextValue | null>(null);

interface OverflowTrackerHookOptions {
    rows: Accessor<readonly RowDescriptor[]>;
    isFocused: Accessor<boolean>;
    selectedRowId: Accessor<string | null>;
    getNaturalWidth: () => number;
    requestHorizontalReset: () => void;
    hasPendingHorizontalReset: () => boolean;
}

function useTreeRowMetrics(
    rows: Accessor<readonly RowDescriptor[]>,
    measureRowWidth: MeasureRowWidth,
    applyContentWidth: (width: number) => void,
) {
    const rowMetrics = createRowMetrics(measureRowWidth, applyContentWidth);
    createEffect(() => {
        rowMetrics.syncRows(rows());
    });
    onCleanup(() => rowMetrics.dispose());
    return rowMetrics;
}

function useTreeAutoscroll(rows: Accessor<readonly RowDescriptor[]>, selectedRowId: Accessor<string | null>) {
    const autoscroll = createAutoscrollService();
    createEffect(() => {
        rows();
        autoscroll.ensureRowVisible(selectedRowId());
    });
    onCleanup(() => autoscroll.dispose());
    return autoscroll;
}

function useTreeOverflowTracker(options: OverflowTrackerHookOptions) {
    const tracker = createOverflowTracker({
        getNaturalWidth: options.getNaturalWidth,
        requestHorizontalReset: options.requestHorizontalReset,
        hasPendingHorizontalReset: options.hasPendingHorizontalReset,
    });
    createEffect(() => {
        options.rows();
        options.isFocused();
        tracker.refresh();
    });
    onCleanup(() => tracker.dispose());
    return tracker;
}

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
    isFocused: Accessor<boolean>;
    onApiReady?: (api: TreeScrollboxApi | undefined) => void;
    onNaturalWidthChange?: (width: number) => void;
}

export function TreeScrollbox(props: TreeScrollboxProps) {
    let scrollBox: ScrollBoxRenderable | undefined;
    let overflowTrackerRef: ReturnType<typeof createOverflowTracker> | null = null;

    const autoscroll = useTreeAutoscroll(props.rows, props.selectedRowId);

    const applyContentWidth = (width: number) => {
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
    };

    const rowMetrics = useTreeRowMetrics(props.rows, props.measureRowWidth, applyContentWidth);

    const overflowTracker = useTreeOverflowTracker({
        rows: props.rows,
        isFocused: props.isFocused,
        selectedRowId: props.selectedRowId,
        getNaturalWidth: rowMetrics.naturalWidth,
        requestHorizontalReset: autoscroll.requestHorizontalReset,
        hasPendingHorizontalReset: autoscroll.hasPendingHorizontalReset,
    });
    overflowTrackerRef = overflowTracker;

    props.onApiReady?.({ scrollBy: autoscroll.scrollBy });
    onCleanup(() => {
        props.onApiReady?.(undefined);
    });

    createEffect(() => {
        props.onNaturalWidthChange?.(rowMetrics.naturalWidth());
    });

    const handleScrollboxRef = (node: ScrollBoxRenderable | undefined) => {
        scrollBox = node;
        autoscroll.setScrollBox(node);
        overflowTracker.setScrollBox(node);
        if (!scrollBox) return;
        applyContentWidth(rowMetrics.contentWidth());
    };

    const contextValue: TreeScrollboxContextValue = {
        registerRowNode: autoscroll.registerRowNode,
    };

    return (
        <scrollbox
            ref={handleScrollboxRef}
            flexDirection="column"
            flexGrow={1}
            height="100%"
            scrollbarOptions={{ visible: false }}
            horizontalScrollbarOptions={{ visible: overflowTracker.horizontalOverflow() }}
            scrollY={true}
            scrollX={true}
        >
            <TreeScrollboxContext.Provider value={contextValue}>
                <box flexDirection="column" width={rowMetrics.contentWidth()} flexShrink={0} alignItems="flex-start">
                    {props.children}
                </box>
            </TreeScrollboxContext.Provider>
        </scrollbox>
    );
}

export type { RowDescriptor, MeasureRowWidth, ScrollDelta };
