import type { MouseEvent, Renderable, ScrollBoxRenderable } from "@opentui/core"
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

export type ScrollPoint = {
  x: number
  y: number
}

export type ScrollDelta = {
  x: number
  y: number
}

export type ScrollIntoViewOptions = {
  trackX?: boolean
}

export type OriScrollboxUserScrollContext = {
  event: MouseEvent
  delta: ScrollDelta
  scrollLeft: number
  scrollTop: number
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
  onUserScroll?: (context: OriScrollboxUserScrollContext) => void
}

const DEFAULT_SCROLL_INSET_Y = 2

export type ViewportRect = {
  x: number
  y: number
  width: number
  height: number
}

export function OriScrollbox(props: OriScrollboxProps) {
  const { theme } = useTheme()
  const {
    onReady,
    minHorizontalThumbWidth,
    scrollSpeed,
    onSync,
    onUserScroll,
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

    if (!scrollSpeed && !onSync && !onUserScroll) {
      return
    }

    // @ts-expect-error onUpdate is protected in typings
    const originalOnUpdate = node.onUpdate?.bind(node)
    // @ts-expect-error onMouseEvent is protected in typings
    const originalOnMouseEvent = node.onMouseEvent?.bind(node)
    const handleMouseEvent =
      scrollSpeed && originalOnMouseEvent
        ? createScrollSpeedHandler(originalOnMouseEvent, scrollSpeed)
        : originalOnMouseEvent

    patchScrollbarUserScroll(node, onUserScroll, onSync)

    // @ts-expect-error onUpdate is protected in typings
    node.onUpdate = (deltaTime: number) => {
      originalOnUpdate?.(deltaTime)
      onSync?.()
    }

    // @ts-expect-error onMouseEvent is protected in typings
    node.onMouseEvent = (event: MouseEvent) => {
      const prevLeft = node.scrollLeft ?? 0
      const prevTop = node.scrollTop ?? 0
      handleMouseEvent?.(event)
      if (event.type === "scroll") {
        const newLeft = node.scrollLeft ?? 0
        const newTop = node.scrollTop ?? 0
        const delta = {
          x: newLeft - prevLeft,
          y: newTop - prevTop,
        }
        if (delta.x !== 0 || delta.y !== 0) {
          onUserScroll?.({
            event,
            delta,
            scrollLeft: newLeft,
            scrollTop: newTop,
          })
        }
      }
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

export function getViewportRect(node: ScrollBoxRenderable): ViewportRect {
  const viewport = node.viewport
  return {
    x: viewport.x,
    y: viewport.y,
    width: viewport.width,
    height: viewport.height,
  }
}

function computeVerticalInset(viewport: ViewportRect): number {
  const maxY = Math.max(0, viewport.height - 1)
  return Math.min(DEFAULT_SCROLL_INSET_Y, Math.floor(maxY / 2))
}

export function computeScrollIntoViewDelta(
  node: ScrollBoxRenderable | undefined,
  target: ScrollPoint,
  options: ScrollIntoViewOptions = {},
): ScrollDelta | null {
  if (!node) {
    return null
  }
  const viewport = getViewportRect(node)
  if (viewport.width <= 0 || viewport.height <= 0) {
    return null
  }
  const insetY = computeVerticalInset(viewport)
  const startX = viewport.x
  const endXExclusive = viewport.x + viewport.width
  const startY = viewport.y + insetY
  const endYExclusive = viewport.y + viewport.height - insetY
  const computeDelta = (point: number, start: number, endExclusive: number) => {
    if (point < start) {
      return point - start
    }
    const pointEnd = point + 1
    if (pointEnd > endExclusive) {
      return pointEnd - endExclusive
    }
    return 0
  }
  return {
    x: options.trackX === false ? 0 : computeDelta(target.x, startX, endXExclusive),
    y: computeDelta(target.y, startY, endYExclusive),
  }
}

export function scrollIntoView(
  node: ScrollBoxRenderable | undefined,
  target: ScrollPoint,
  options: ScrollIntoViewOptions = {},
): ScrollDelta | null {
  const delta = computeScrollIntoViewDelta(node, target, options)
  if (!delta) {
    return null
  }
  if (delta.x !== 0 || delta.y !== 0) {
    node?.scrollBy(delta)
  }
  return delta
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

function patchScrollbarUserScroll(
  node: ScrollBoxRenderable,
  onUserScroll: ((context: OriScrollboxUserScrollContext) => void) | undefined,
  onSync: (() => void) | undefined,
) {
  type State = {
    active: boolean
    event?: MouseEvent
    scrollLeft: number
    scrollTop: number
  }

  const emitUserScroll = (state: State) => {
    const scrollLeft = node.scrollLeft ?? 0
    const scrollTop = node.scrollTop ?? 0
    const delta = {
      x: scrollLeft - state.scrollLeft,
      y: scrollTop - state.scrollTop,
    }

    state.scrollLeft = scrollLeft
    state.scrollTop = scrollTop

    if (!state.active) return
    if (delta.x === 0 && delta.y === 0) return

    const event = state.event
    if (event) {
      onUserScroll?.({
        event,
        delta,
        scrollLeft,
        scrollTop,
      })
    }

    onSync?.()
  }

  const verticalState: State = {
    active: false,
    event: undefined,
    scrollLeft: node.scrollLeft ?? 0,
    scrollTop: node.scrollTop ?? 0,
  }
  const horizontalState: State = {
    active: false,
    event: undefined,
    scrollLeft: node.scrollLeft ?? 0,
    scrollTop: node.scrollTop ?? 0,
  }

  const patchScrollbarMouse = (item: { renderable: Renderable; state: State }) => {
    const original = item.renderable.processMouseEvent.bind(item.renderable)

    item.renderable.processMouseEvent = (event: MouseEvent) => {
      const startsInteraction = event.type === "down" || event.type === "drag"
      const endsInteraction = event.type === "up" || event.type === "drag-end" || event.type === "drop"

      if (startsInteraction || endsInteraction) {
        item.state.active = true
        item.state.event = event
      }

      if (endsInteraction) {
        queueMicrotask(() => {
          if (item.state.event !== event) return
          item.state.active = false
        })
      }

      original(event)
    }
  }

  patchScrollbarMouse({ renderable: node.verticalScrollBar.slider, state: verticalState })
  patchScrollbarMouse({ renderable: node.verticalScrollBar.startArrow, state: verticalState })
  patchScrollbarMouse({ renderable: node.verticalScrollBar.endArrow, state: verticalState })
  patchScrollbarMouse({ renderable: node.horizontalScrollBar.slider, state: horizontalState })
  patchScrollbarMouse({ renderable: node.horizontalScrollBar.startArrow, state: horizontalState })
  patchScrollbarMouse({ renderable: node.horizontalScrollBar.endArrow, state: horizontalState })

  node.verticalScrollBar.on("change", () => {
    emitUserScroll(verticalState)
  })
  node.horizontalScrollBar.on("change", () => {
    emitUserScroll(horizontalState)
  })
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
