import type { MouseEvent, ScrollBoxRenderable } from "@opentui/core"
import { useTheme } from "@ui/providers/theme"
import type { JSX } from "solid-js"

const defaultMultipliers = {
  horizontal: 3,
  vertical: 1,
}

type ScrollDirection = "up" | "down" | "left" | "right"

type SliderWithMinThumbPatch = {
  __minThumbSizePatch?: {
    minWidth: number
    getVirtualThumbSize: () => number
  }
  getVirtualThumbSize?: () => number
}

type ScrollSpeedMultipliers = {
  horizontal?: number
  vertical?: number
}

type ScrollbarTrackOptions = {
  foregroundColor?: string
  backgroundColor?: string
  [key: string]: unknown
}

type ScrollbarOptions = {
  trackOptions?: ScrollbarTrackOptions
  [key: string]: unknown
}

type ScrollboxBaseProps = {
  children?: JSX.Element
  scrollX?: boolean
  scrollY?: boolean
  horizontalScrollbarOptions?: ScrollbarOptions
  verticalScrollbarOptions?: ScrollbarOptions
  [key: string]: unknown
}

export type OriScrollboxProps = ScrollboxBaseProps & {
  onReady?: (node: ScrollBoxRenderable | undefined) => void
  minHorizontalThumbWidth?: number
  scrollSpeed?: ScrollSpeedMultipliers
  onSync?: () => void
}

export function OriScrollbox(props: OriScrollboxProps) {
  const { theme } = useTheme()
  const {
    onReady,
    minHorizontalThumbWidth,
    scrollSpeed,
    onSync,
    children,
    scrollX,
    scrollY,
    horizontalScrollbarOptions,
    verticalScrollbarOptions,
    ...scrollboxProps
  } = props

  const horizontal = mergeScrollbarOptions(
    {
      flexShrink: 0,
      minHeight: 1,
      trackOptions: {
        foregroundColor: theme().get("scrollbar_foreground"),
        backgroundColor: theme().get("scrollbar_background"),
      },
    },
    horizontalScrollbarOptions,
  )

  const vertical = mergeScrollbarOptions(
    {
      flexShrink: 0,
      minWidth: 1,
      trackOptions: {
        foregroundColor: theme().get("scrollbar_foreground"),
        backgroundColor: theme().get("scrollbar_background"),
      },
    },
    verticalScrollbarOptions,
  )

  const handleRef = (node: ScrollBoxRenderable | undefined) => {
    onReady?.(node)
    if (!node) return

    enforceStableScrollboxOverflowLayout(node)

    if (typeof minHorizontalThumbWidth === "number") {
      enforceHorizontalScrollbarMinThumbWidth(node, minHorizontalThumbWidth)
    }

    if (!scrollSpeed && !onSync) return

    // @ts-expect-error onUpdate is protected in typings
    const originalOnUpdate = node.onUpdate?.bind(node)
    // @ts-expect-error onMouseEvent is protected in typings
    const originalOnMouseEvent = node.onMouseEvent?.bind(node)
    const handleMouseEvent =
      scrollSpeed && originalOnMouseEvent
        ? createScrollSpeedHandler(originalOnMouseEvent, scrollSpeed)
        : originalOnMouseEvent

    // @ts-expect-error onUpdate is protected in typings
    node.onUpdate = (deltaTime: number) => {
      originalOnUpdate?.(deltaTime)
      onSync?.()
    }

    // @ts-expect-error onMouseEvent is protected in typings
    node.onMouseEvent = (event: MouseEvent) => {
      handleMouseEvent?.(event)
      onSync?.()
    }
  }

  return (
    <scrollbox
      {...scrollboxProps}
      ref={handleRef}
      scrollX={scrollX ?? true}
      scrollY={scrollY ?? true}
      horizontalScrollbarOptions={horizontal}
      verticalScrollbarOptions={vertical}
    >
      {children}
    </scrollbox>
  )
}

function mergeScrollbarOptions(base: ScrollbarOptions, custom: ScrollbarOptions | undefined): ScrollbarOptions {
  if (!custom) return base
  return {
    ...base,
    ...custom,
    trackOptions: {
      ...(base.trackOptions ?? {}),
      ...(custom.trackOptions ?? {}),
    },
  }
}

// there's a bug that makes horizontal scrollbox tiny for no reason in opentui
// we're working aroung
function enforceHorizontalScrollbarMinThumbWidth(scrollBox: ScrollBoxRenderable | undefined, minWidth: number) {
  if (!scrollBox || !Number.isFinite(minWidth) || minWidth <= 0) return

  const slider = scrollBox.horizontalScrollBar?.slider as unknown as SliderWithMinThumbPatch | undefined
  if (!slider) return
  if (slider.__minThumbSizePatch?.minWidth === minWidth) return

  const original = slider.__minThumbSizePatch?.getVirtualThumbSize ?? slider.getVirtualThumbSize?.bind(slider)
  if (!original) return

  slider.__minThumbSizePatch = { minWidth, getVirtualThumbSize: original }

  const minVirtual = Math.max(1, Math.round(minWidth * 2))
  slider.getVirtualThumbSize = () => {
    const orientation = (slider as { orientation?: "vertical" | "horizontal" }).orientation
    const width = (slider as { width?: number }).width ?? 0
    const height = (slider as { height?: number }).height ?? 0
    const trackSize = orientation === "vertical" ? height * 2 : width * 2
    const boundedMin = trackSize > 0 ? Math.min(minVirtual, trackSize) : minVirtual
    return Math.max(original(), boundedMin)
  }

  scrollBox.requestRender()
}

// without this hack scrollbars sometimes go beyond the normal scrollbox box
function enforceStableScrollboxOverflowLayout(scrollBox: ScrollBoxRenderable | undefined) {
  if (!scrollBox) return

  scrollBox.verticalScrollBar.flexShrink = 0
  scrollBox.verticalScrollBar.minWidth = 1
  scrollBox.horizontalScrollBar.flexShrink = 0
  scrollBox.horizontalScrollBar.minHeight = 1
  scrollBox.requestRender()
}

function createScrollSpeedHandler(
  baseHandler: ((event: MouseEvent) => void) | undefined,
  multipliers: ScrollSpeedMultipliers,
) {
  if (!baseHandler) {
    return undefined
  }
  const { horizontal, vertical } = { ...defaultMultipliers, ...multipliers }

  return (event: MouseEvent) => {
    if (event.type !== "scroll" || !event.scroll) {
      baseHandler(event)
      return
    }

    const direction = getScrollDirection(event)
    const axisMultiplier = direction === "left" || direction === "right" ? horizontal : vertical
    if (axisMultiplier === 1) {
      baseHandler(event)
      return
    }

    const baseDelta = typeof event.scroll.delta === "number" ? event.scroll.delta : 0
    const scaledEvent = {
      ...event,
      scroll: {
        ...event.scroll,
        delta: baseDelta * axisMultiplier,
      },
    } as MouseEvent

    baseHandler(scaledEvent)
  }
}

function getScrollDirection(event: MouseEvent): ScrollDirection | undefined {
  const direction = event.scroll?.direction
  if (!direction) return undefined
  if (!event.modifiers?.shift) return direction
  if (direction === "up") return "left"
  if (direction === "down") return "right"
  if (direction === "right") return "down"
  return "up"
}
