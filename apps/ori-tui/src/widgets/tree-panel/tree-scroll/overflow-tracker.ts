import { createSignal } from "solid-js";
import type { ScrollBoxRenderable } from "@opentui/core";

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
    let measureHandle: ReturnType<typeof setTimeout> | null = null;

    // Deferred measurement — waits for layout to stabilize on next tick
    const scheduleMeasurement = () => {
        if (measureHandle) return;
        measureHandle = setTimeout(() => {
            measureHandle = null;
            measure();
        }, 0);
    };

    const measure = () => {
        if (!scrollBox) {
            setHasHorizontalOverflow(false);
            return;
        }

        const viewportWidth = scrollBox.viewport?.width ?? 0;
        const naturalWidth = options.getNaturalWidth();
        const previousOverflow = hasHorizontalOverflow();
        const hasOverflow = naturalWidth > viewportWidth;

        setHasHorizontalOverflow(hasOverflow);

        if (!hasOverflow && (previousOverflow || options.hasPendingHorizontalReset())) {
            options.requestHorizontalReset();
        }
    };

    const refresh = () => {
        scheduleMeasurement();
    };

    const setScrollBox = (node: ScrollBoxRenderable | undefined) => {
        scrollBox = node;
        if (!scrollBox) {
            if (measureHandle) {
                clearTimeout(measureHandle);
                measureHandle = null;
            }
            setHasHorizontalOverflow(false);
            return;
        }
        scheduleMeasurement();
    };

    const dispose = () => {
        if (measureHandle) {
            clearTimeout(measureHandle);
            measureHandle = null;
        }
    };

    return {
        refresh,
        horizontalOverflow: hasHorizontalOverflow,
        setScrollBox,
        dispose,
    };
}
