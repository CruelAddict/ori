import { createSignal } from "solid-js";
import type { ScrollBoxRenderable } from "@opentui/core";

const MAX_OVERFLOW_REFRESH_ATTEMPTS = 5;

export interface OverflowTrackerOptions {
    getNaturalWidth: () => number;
    requestHorizontalReset: () => void;
    hasPendingHorizontalReset: () => boolean;
}

export interface OverflowTracker {
    refresh(): void;
    horizontalOverflow: () => boolean;
    setScrollBox(node: ScrollBoxRenderable | undefined): void;
    dispose(): void;
}

export function createOverflowTracker(options: OverflowTrackerOptions): OverflowTracker {
    const [hasHorizontalOverflow, setHasHorizontalOverflow] = createSignal(false);

    let scrollBox: ScrollBoxRenderable | undefined;
    let lastMeasuredViewportWidth = 0;
    let pendingOverflowRefresh = false;
    let overflowRefreshAttempts = 0;
    let refreshHandle: ReturnType<typeof setTimeout> | null = null;

    const refresh = () => {
        overflowRefreshAttempts = 0;
        measureOverflowState();
        scheduleOverflowRefresh();
    };

    const setScrollBox = (node: ScrollBoxRenderable | undefined) => {
        scrollBox = node;
        if (!scrollBox) {
            lastMeasuredViewportWidth = 0;
            pendingOverflowRefresh = false;
            overflowRefreshAttempts = 0;
            if (refreshHandle) {
                clearTimeout(refreshHandle);
                refreshHandle = null;
            }
            setHasHorizontalOverflow(false);
            return;
        }
        refresh();
    };

    const measureOverflowState = () => {
        if (!scrollBox) {
            lastMeasuredViewportWidth = 0;
            setHasHorizontalOverflow(false);
            return 0;
        }
        const viewportWidth = scrollBox.viewport?.width ?? 0;
        lastMeasuredViewportWidth = viewportWidth;
        const previousOverflow = hasHorizontalOverflow();
        const hasOverflow = options.getNaturalWidth() > viewportWidth;
        setHasHorizontalOverflow(hasOverflow);
        if (!hasOverflow) {
            if (previousOverflow || options.hasPendingHorizontalReset()) {
                options.requestHorizontalReset();
            }
        }
        return viewportWidth;
    };

    const scheduleOverflowRefresh = () => {
        if (pendingOverflowRefresh) return;
        if (!scrollBox) return;
        pendingOverflowRefresh = true;
        refreshHandle = setTimeout(() => {
            pendingOverflowRefresh = false;
            refreshHandle = null;
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

    const dispose = () => {
        if (refreshHandle) {
            clearTimeout(refreshHandle);
            refreshHandle = null;
        }
        pendingOverflowRefresh = false;
    };

    return {
        refresh,
        horizontalOverflow: hasHorizontalOverflow,
        setScrollBox,
        dispose,
    };
}
