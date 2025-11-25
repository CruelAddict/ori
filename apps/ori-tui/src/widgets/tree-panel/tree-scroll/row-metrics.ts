import { createSignal } from "solid-js";

export const MIN_CONTENT_WIDTH = 36;

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
    setMinimumVisibleWidth(width: number): void;
    contentWidth: () => number;
    naturalWidth: () => number;
    dispose(): void;
}

const MAX_TIMEOUT_BATCH = 200;

export function createRowMetrics(measureRowWidth: MeasureRowWidth, onWidthUpdate: WidthChangeHandler): RowMetricsService {
    const rowWidths = new Map<string, RowMeta>();
    const depthStats = new Map<number, WidthEntry>();
    const activeRowIds = new Set<string>();
    const [contentWidth, setContentWidth] = createSignal(MIN_CONTENT_WIDTH);
    const [naturalWidth, setNaturalWidth] = createSignal(MIN_CONTENT_WIDTH);

    let forcedMinContentWidth = MIN_CONTENT_WIDTH;
    let pendingMeasure: RowDescriptor[] = [];
    let measureHandle: ReturnType<typeof setTimeout> | null = null;
    let widthRecalcHandle: ReturnType<typeof setTimeout> | null = null;
    let pendingWidthUpdate = false;

    const syncRows = (rows: readonly RowDescriptor[]) => {
        activeRowIds.clear();
        for (const row of rows) {
            activeRowIds.add(row.id);
            pendingMeasure.push(row);
        }
        const removed: string[] = [];
        for (const id of rowWidths.keys()) {
            if (!activeRowIds.has(id)) removed.push(id);
        }
        for (const id of removed) removeRowWidth(id);
        scheduleMeasureBatch();
    };

    const setMinimumVisibleWidth = (width: number) => {
        const normalized = Math.max(width, MIN_CONTENT_WIDTH);
        if (normalized === forcedMinContentWidth) return;
        forcedMinContentWidth = normalized;
        emitWidthChange(naturalWidth());
    };

    const scheduleMeasureBatch = () => {
        if (measureHandle) return;
        measureHandle = setTimeout(() => {
            measureHandle = null;
            runMeasureBatch();
        }, 0);
    };

    const runMeasureBatch = () => {
        let remaining = MAX_TIMEOUT_BATCH;
        while (pendingMeasure.length && remaining > 0) {
            const row = pendingMeasure.shift()!;
            if (!activeRowIds.has(row.id)) continue;
            upsertRowWidth(row);
            remaining -= 1;
        }
        if (pendingMeasure.length) scheduleMeasureBatch();
        else scheduleWidthRecalc();
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
        const applied = Math.max(widest, forcedMinContentWidth);
        setContentWidth(applied);
        onWidthUpdate(applied);
    };

    const dispose = () => {
        if (measureHandle) {
            clearTimeout(measureHandle);
            measureHandle = null;
        }
        if (widthRecalcHandle) {
            clearTimeout(widthRecalcHandle);
            widthRecalcHandle = null;
        }
        pendingMeasure = [];
        activeRowIds.clear();
        rowWidths.clear();
        depthStats.clear();
    };

    return {
        syncRows,
        setMinimumVisibleWidth,
        contentWidth,
        naturalWidth,
        dispose,
    };
}
