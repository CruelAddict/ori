import { useLogger } from "@app/providers/logger";
import type { ScrollBoxRenderable } from "@opentui/core";
import { createSignal } from "solid-js";

export type OverflowTrackerOptions = {
  getNaturalWidth: () => number;
  requestHorizontalReset: () => void;
  hasPendingHorizontalReset: () => boolean;
};

export type OverflowTracker = {
  refresh(): void;
  horizontalOverflow: () => boolean;
  setScrollBox(node: ScrollBoxRenderable | undefined): void;
  dispose(): void;
};

const MAX_ZERO_WIDTH_MEASURE_ATTEMPTS = 5;

export function createOverflowTracker(options: OverflowTrackerOptions): OverflowTracker {
  const logger = useLogger();
  logger.debug({ options }, "Creating overflow tracker");

  const [hasHorizontalOverflow, setHasHorizontalOverflow] = createSignal(false);

  let scrollBox: ScrollBoxRenderable | undefined;
  let measureHandle: ReturnType<typeof setTimeout> | null = null;
  let zeroWidthAttempts = 0;

  // Deferred measurement — waits for layout to stabilize on next tick
  const scheduleMeasurement = () => {
    logger.debug({ hasMeasureHandle: !!measureHandle }, "scheduleMeasurement() called");
    if (measureHandle) return;
    logger.debug("Setting up measurement timeout");
    measureHandle = setTimeout(() => {
      logger.debug("Measurement timeout triggered");
      measureHandle = null;
      measure();
    }, 100);
  };

  const measure = () => {
    logger.debug({ scrollBox: !!scrollBox }, "measure() called");
    if (!scrollBox) {
      logger.debug("No scrollBox, resetting overflow state");
      setHasHorizontalOverflow(false);
      zeroWidthAttempts = 0;
      return;
    }

    const viewportWidth = scrollBox.viewport?.width ?? 0;
    if (viewportWidth <= 0) {
      zeroWidthAttempts += 1;
      if (zeroWidthAttempts >= MAX_ZERO_WIDTH_MEASURE_ATTEMPTS) {
        logger.debug({ zeroWidthAttempts }, "Stopping auto-reschedule after repeated zero widths");
        return;
      }
      scheduleMeasurement();
      return;
    }

    zeroWidthAttempts = 0;
    const naturalWidth = options.getNaturalWidth();
    const previousOverflow = hasHorizontalOverflow();
    const hasOverflow = naturalWidth > viewportWidth;

    logger.debug(
      {
        viewportWidth,
        naturalWidth,
        hasOverflow,
        previousOverflow,
        hasPendingReset: options.hasPendingHorizontalReset(),
      },
      "Overflow measurement result",
    );

    if (hasOverflow !== previousOverflow) {
      setHasHorizontalOverflow(hasOverflow);
    }

    if (!hasOverflow && (previousOverflow || options.hasPendingHorizontalReset())) {
      logger.debug(
        { previousOverflow, hasPendingReset: options.hasPendingHorizontalReset() },
        "Requesting horizontal reset",
      );
      options.requestHorizontalReset();
    }
  };

  const refresh = () => {
    logger.debug("refresh() called");
    scheduleMeasurement();
  };

  const setScrollBox = (node: ScrollBoxRenderable | undefined) => {
    logger.debug({ node: !!node, previousScrollBox: !!scrollBox }, "setScrollBox() called");
    scrollBox = node;
    if (!scrollBox) {
      logger.debug("ScrollBox cleared, cleaning up and resetting state");
      if (measureHandle) {
        clearTimeout(measureHandle);
        measureHandle = null;
      }
      setHasHorizontalOverflow(false);
      return;
    }
    logger.debug("ScrollBox set, scheduling measurement");
    scheduleMeasurement();
  };

  const dispose = () => {
    logger.debug({ hasMeasureHandle: !!measureHandle }, "dispose() called");
    if (measureHandle) {
      clearTimeout(measureHandle);
      measureHandle = null;
    }
  };

  const tracker = {
    refresh,
    horizontalOverflow: hasHorizontalOverflow,
    setScrollBox,
    dispose,
  };

  logger.debug("Overflow tracker created and returned");
  return tracker;
}
