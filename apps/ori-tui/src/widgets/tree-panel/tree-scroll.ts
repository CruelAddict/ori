import { createSignal } from "solid-js";
import type { BoxRenderable, ScrollBoxRenderable } from "@opentui/core";

const MIN_CONTENT_WIDTH = 36;
const MAX_OVERFLOW_REFRESH_ATTEMPTS = 5;
const MAX_ENSURE_ATTEMPTS = 5;

type WidthEntry = { id: string; width: number };
type RowMeta = { depth: number; width: number };

type ScrollDelta = { x: number; y: number };

// Minimal descriptor for width measurement and depth stats
export interface RowDescriptor {
    id: string;
    depth: number;
}

type MeasureRowWidth = (row: RowDescriptor) => number;

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
}

export function createTreeScrollManager(measureRowWidth: MeasureRowWidth): TreeScrollManager {
    const rowNodes = new Map<string, BoxRenderable>();
    const depthStats = new Map<number, WidthEntry>();
    const rowWidths = new Map<string, RowMeta>();
    const [contentWidth, setContentWidth] = createSignal(MIN_CONTENT_WIDTH);
    const [naturalWidth, setNaturalWidth] = createSignal(MIN_CONTENT_WIDTH);
    const [hasHorizontalOverflow, setHasHorizontalOverflow] = createSignal(false);

    let scrollBox: ScrollBoxRenderable | undefined;
    let forcedMinContentWidth = MIN_CONTENT_WIDTH;
    let pendingWidthUpdate = false;
    let pendingEnsure = false;
    let pendingOverflowRefresh = false;
    let overflowRefreshAttempts = 0;
    let lastMeasuredViewportWidth = 0;
    let ensureTarget: string | null = null;
    let ensureAttempts = 0;

    // Async width measurement batching so measuring never blocks UI
    const MEASURE_BATCH_SIZE = 200;
    let pendingMeasure: RowDescriptor[] = [];
    let measureScheduled = false;

    const setScrollBox = (node: ScrollBoxRenderable | undefined) => {
        scrollBox = node;
        if (scrollBox) {
            applyContentWidth(contentWidth());
            refreshOverflowState();
        }
    };

    const registerRowNode = (rowId: string, node: BoxRenderable | undefined) => {
        if (!node) {
            rowNodes.delete(rowId);
            return;
        }
        rowNodes.set(rowId, node);
        if (ensureTarget === rowId) {
            scheduleEnsureTask();
        }
    };

    const syncRows = (rows: readonly RowDescriptor[]) => {
        const presentIds = new Set<string>();
        for (const row of rows) {
            presentIds.add(row.id);
            pendingMeasure.push(row);
        }
        const removed: string[] = [];
        for (const id of rowWidths.keys()) {
            if (!presentIds.has(id)) removed.push(id);
        }
        for (const id of removed) removeRowWidth(id);
        scheduleMeasureBatch();
    };

    const scheduleMeasureBatch = () => {
        if (measureScheduled) return;
        measureScheduled = true;
        setTimeout(runMeasureBatch, 0);
    };

    const runMeasureBatch = () => {
        measureScheduled = false;
        let remaining = MEASURE_BATCH_SIZE;
        while (pendingMeasure.length && remaining > 0) {
            const row = pendingMeasure.shift()!;
            upsertRowWidth(row);
            remaining -= 1;
        }
        if (pendingMeasure.length) {
            measureScheduled = true;
            setTimeout(runMeasureBatch, 0);
        } else {
            scheduleWidthRecalc();
        }
    };

    const ensureRowVisible = (rowId: string | null) => {
        ensureTarget = rowId;
        ensureAttempts = 0;
        if (!rowId) {
            return;
        }
        scheduleEnsureTask();
    };

    function scheduleEnsureTask() {
        if (pendingEnsure) return;
        pendingEnsure = true;
        setTimeout(runEnsureVisibleTask, 0);
    }

    const scrollBy = (delta: ScrollDelta) => {
        scrollBox?.scrollBy(delta);
    };

    const upsertRowWidth = (row: RowDescriptor) => {
        const width = measureRowWidth(row);
        const current = rowWidths.get(row.id);
        rowWidths.set(row.id, { depth: row.depth, width });
        const depthEntry = depthStats.get(row.depth);
        if (!depthEntry || width >= depthEntry.width) {
            depthStats.set(row.depth, { id: row.id, width });
        } else if (current && depthEntry.id === row.id && width < depthEntry.width) {
            recalcDepth(row.depth);
        }
    };

    const removeRowWidth = (rowId: string) => {
        const meta = rowWidths.get(rowId);
        if (!meta) return;
        rowWidths.delete(rowId);
        const depthEntry = depthStats.get(meta.depth);
        if (depthEntry?.id === rowId) recalcDepth(meta.depth);
    };

    const recalcDepth = (depth: number) => {
        let best: WidthEntry | undefined;
        for (const [rowId, meta] of rowWidths.entries()) {
            if (meta.depth !== depth) continue;
            if (!best || meta.width > best.width) best = { id: rowId, width: meta.width };
        }
        if (best) depthStats.set(depth, best);
        else depthStats.delete(depth);
    };

    const scheduleWidthRecalc = () => {
        if (pendingWidthUpdate) return;
        pendingWidthUpdate = true;
        setTimeout(() => {
            pendingWidthUpdate = false;
            let widest = MIN_CONTENT_WIDTH;
            for (const { width } of depthStats.values()) {
                if (width > widest) widest = width;
            }
            setNaturalWidth(widest);
            applyContentWidth(Math.max(widest, forcedMinContentWidth));
        }, 0);
    };

    const setMinimumVisibleWidth = (width: number) => {
        const normalized = Math.max(width, MIN_CONTENT_WIDTH);
        if (normalized === forcedMinContentWidth) return;
        forcedMinContentWidth = normalized;
        applyContentWidth(Math.max(naturalWidth(), forcedMinContentWidth));
    };

    function runEnsureVisibleTask() {
        pendingEnsure = false;
        if (!ensureTarget || !scrollBox) {
            ensureTarget = null;
            ensureAttempts = 0;
            return;
        }
        const node = rowNodes.get(ensureTarget);
        if (!node) {
            if (ensureAttempts >= MAX_ENSURE_ATTEMPTS) {
                ensureTarget = null;
                ensureAttempts = 0;
                return;
            }
            ensureAttempts += 1;
            scheduleEnsureTask();
            return;
        }
        const viewport = (scrollBox as any).viewport as BoxRenderable | undefined;
        if (!viewport) {
            ensureTarget = null;
            ensureAttempts = 0;
            return;
        }

        let deltaY = 0;
        const nodeTop = node.y;
        const nodeBottom = node.y + node.height;
        const viewportTop = viewport.y;
        const viewportBottom = viewport.y + viewport.height;
        if (nodeTop < viewportTop) deltaY = nodeTop - viewportTop;
        else if (nodeBottom > viewportBottom) deltaY = nodeBottom - viewportBottom;

        if (deltaY !== 0) scrollBox.scrollBy({ x: 0, y: deltaY });
        ensureTarget = null;
        ensureAttempts = 0;
    }

    const applyContentWidth = (width: number) => {
        setContentWidth(width);
        if (!scrollBox) {
            refreshOverflowState();
            return;
        }
        scrollBox.content.minWidth = width;
        scrollBox.content.width = width;
        scrollBox.content.maxWidth = width;
        scrollBox.content.flexGrow = 0;
        scrollBox.content.flexShrink = 0;
        scrollBox.requestRender();
        refreshOverflowState();
    };

    const refreshOverflowState = () => {
        overflowRefreshAttempts = 0;
        measureOverflowState();
        scheduleOverflowRefresh();
    };

    const measureOverflowState = () => {
        if (!scrollBox) {
            lastMeasuredViewportWidth = 0;
            setHasHorizontalOverflow(false);
            return 0;
        }
        const viewportWidth = scrollBox.viewport?.width ?? 0;
        lastMeasuredViewportWidth = viewportWidth;
        const hasOverflow = naturalWidth() > viewportWidth;
        setHasHorizontalOverflow(hasOverflow);
        return viewportWidth;
    };

    const scheduleOverflowRefresh = () => {
        if (pendingOverflowRefresh) return;
        if (!scrollBox) return;
        pendingOverflowRefresh = true;
        setTimeout(() => {
            pendingOverflowRefresh = false;
            if (!scrollBox) {
                overflowRefreshAttempts = 0;
                lastMeasuredViewportWidth = 0;
                return;
            }
            const previousWidth = lastMeasuredViewportWidth;
            const measuredWidth = measureOverflowState();
            const widthChanged = measuredWidth !== previousWidth;
            const widthUnset = measuredWidth === 0;
            if ((widthChanged || widthUnset) && overflowRefreshAttempts < MAX_OVERFLOW_REFRESH_ATTEMPTS) {
                overflowRefreshAttempts += 1;
                scheduleOverflowRefresh();
            } else {
                overflowRefreshAttempts = 0;
            }
        }, 0);
    };

    return {
        setScrollBox,
        registerRowNode,
        syncRows,
        ensureRowVisible,
        scrollBy,
        contentWidth,
        naturalContentWidth: naturalWidth,
        setMinimumVisibleWidth,
        refreshOverflowState,
        horizontalOverflow: hasHorizontalOverflow,
    };
}
