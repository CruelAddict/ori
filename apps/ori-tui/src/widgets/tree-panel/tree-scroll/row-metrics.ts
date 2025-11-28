import { createSignal } from "solid-js";

export const MIN_CONTENT_WIDTH = 20;
const clampContentWidth = (width: number) => Math.max(width, MIN_CONTENT_WIDTH);

export type RowDescriptor = {
    id: string;
    depth: number;
};

export type MeasureRowWidth = (row: RowDescriptor) => number;

type WidthChangeHandler = (contentWidth: number) => void;
type WidthEntry = { id: string; width: number };
type RowMeta = { depth: number; width: number };

export interface RowMetricsService {
    syncRows(rows: readonly RowDescriptor[]): void;
    contentWidth: () => number;
    naturalWidth: () => number;
    dispose(): void;
}

// the reason this file exists is that opentui can't properly handle scrollbar with changing content & viewport width
export function createRowMetrics(measureRowWidth: MeasureRowWidth, onWidthUpdate: WidthChangeHandler): RowMetricsService {
    const rowWidths = new Map<string, RowMeta>();
    const depthStats = new Map<number, WidthEntry>();
    const activeRowIds = new Set<string>();
    const [contentWidth, setContentWidth] = createSignal(MIN_CONTENT_WIDTH);
    const [naturalWidth, setNaturalWidth] = createSignal(MIN_CONTENT_WIDTH);

    let viewportWidth = clampContentWidth(readTerminalWidth());
    let widthRecalcHandle: ReturnType<typeof setTimeout> | null = null;
    let pendingWidthUpdate = false;

    const syncRows = (rows: readonly RowDescriptor[]) => {
        activeRowIds.clear();
        for (const row of rows) {
            activeRowIds.add(row.id);
            if (!rowWidths.has(row.id)) {
                upsertRowWidth(row);
            }
        }
        const removed: string[] = [];
        for (const id of rowWidths.keys()) {
            if (!activeRowIds.has(id)) removed.push(id);
        }
        for (const id of removed) removeRowWidth(id);
        scheduleWidthRecalc();
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
        scheduleWidthRecalc();
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
        widthRecalcHandle = setTimeout(() => {
            pendingWidthUpdate = false;
            widthRecalcHandle = null;
            let widest = MIN_CONTENT_WIDTH;
            for (const { width } of depthStats.values()) {
                if (width > widest) widest = width;
            }
            emitWidthChange(widest);
        }, 0);
    };

    const emitWidthChange = (widest: number) => {
        setNaturalWidth(widest);
        const applied = Math.max(widest, viewportWidth);
        setContentWidth(applied);
        onWidthUpdate(applied);
    };

    const handleViewportResize = () => {
        const normalized = clampContentWidth(readTerminalWidth());
        if (normalized === viewportWidth) return;
        viewportWidth = normalized;
        emitWidthChange(naturalWidth());
    };

    const detachViewportResize = attachViewportResizeListener(handleViewportResize);
    emitWidthChange(naturalWidth());

    const dispose = () => {
        detachViewportResize();
        if (widthRecalcHandle) {
            clearTimeout(widthRecalcHandle);
            widthRecalcHandle = null;
        }
        activeRowIds.clear();
        rowWidths.clear();
        depthStats.clear();
    };

    return {
        syncRows,
        contentWidth,
        naturalWidth,
        dispose,
    };
}

function readTerminalWidth() {
    if (typeof process === "undefined") return 0;
    const columns = process.stdout?.columns;
    return columns ?? 0;
}

function attachViewportResizeListener(handler: () => void) {
    if (typeof process === "undefined") return () => { };
    const stdout = process.stdout;
    stdout?.on?.("resize", handler);
    return () => {
        stdout?.off?.("resize", handler);
    };
}
