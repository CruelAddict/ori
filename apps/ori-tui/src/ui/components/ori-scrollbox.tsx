import type { MouseEvent, ScrollBoxRenderable } from "@opentui/core"
import { useTheme } from "@ui/providers/theme"
import { cursorScrolloffY } from "@ui/services/scroll-follow-settings"
import type { Accessor, JSX } from "solid-js"

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

export type FollowPoint = {
  x: number
  y: number
}

export type ScrollPoint = FollowPoint

export type ScrollAxisMovement = -1 | 0 | 1

export type ScrollBand = {
  left: number
  top: number
  right: number
  bottom: number
}

export type ScrollDelta = {
  x: number
  y: number
}

export type ScrollMovement = {
  x?: ScrollAxisMovement
  y?: ScrollAxisMovement
}

export type ScrollBoundaryConfig = {
  scrolloffY?: number | Accessor<number>
  insetTop?: number
  insetBottom?: number
  insetLeft?: number
  insetRight?: number
}

export type ScrollIntoViewOptions = ScrollBoundaryConfig & {
  trackX?: boolean
  movement?: ScrollMovement
}

export type ScrollIntoViewComputation = {
  target: ScrollPoint
  viewport: ViewportRect
  band: ScrollBand
  delta: ScrollDelta
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

const DEFAULT_SCROLL_INSET_Y = cursorScrolloffY

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
        const nextLeft = node.scrollLeft ?? 0
        const nextTop = node.scrollTop ?? 0
        const delta = {
          x: nextLeft - prevLeft,
          y: nextTop - prevTop,
        }
        if (delta.x !== 0 || delta.y !== 0) {
          onUserScroll?.({
            event,
            delta,
            scrollLeft: nextLeft,
            scrollTop: nextTop,
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

export function getViewportRect(node: ScrollBoxRenderable | undefined): ViewportRect | undefined {
  if (!node) {
    return undefined
  }
  const viewport = (
    node as ScrollBoxRenderable & { viewport?: { x?: number; y?: number; width?: number; height?: number } }
  ).viewport
  if (!viewport) {
    return undefined
  }
  const x = toFiniteNumber(viewport.x)
  const y = toFiniteNumber(viewport.y)
  const width = toFiniteNumber(viewport.width)
  const height = toFiniteNumber(viewport.height)
  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    return undefined
  }
  return {
    x,
    y,
    width,
    height,
  }
}

function normalizeScrollPoint(target: ScrollPoint): ScrollPoint | null {
  const x = toFiniteNumber(target.x)
  const y = toFiniteNumber(target.y)
  if (x === undefined || y === undefined) {
    return null
  }
  return {
    x: Math.floor(x),
    y: Math.floor(y),
  }
}

function toFiniteNumber(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!Number.isFinite(value)) {
    return undefined
  }
  return value
}

function resolveScrollInsetY(value: number | Accessor<number> | undefined): number {
  if (typeof value === "function") {
    return value()
  }
  if (value !== undefined) {
    return value
  }
  return DEFAULT_SCROLL_INSET_Y
}

function normalizeInset(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined) {
    return fallback
  }
  if (!Number.isFinite(value)) {
    return fallback
  }
  return Math.min(max, Math.max(0, Math.floor(value)))
}

export function computeViewportBand(viewport: ViewportRect, options: ScrollBoundaryConfig = {}): ScrollBand {
  const maxX = Math.max(0, viewport.width - 1)
  const maxY = Math.max(0, viewport.height - 1)
  const fallbackY = normalizeInset(resolveScrollInsetY(options.scrolloffY), 0, Math.floor(maxY / 2))
  const leftInset = normalizeInset(options.insetLeft, 0, maxX)
  const rightInset = normalizeInset(options.insetRight, 0, maxX)
  const topInset = normalizeInset(options.insetTop, fallbackY, maxY)
  const bottomInset = normalizeInset(options.insetBottom, fallbackY, maxY)
  const left = Math.min(leftInset, Math.max(0, maxX - rightInset))
  const right = Math.min(rightInset, Math.max(0, maxX - left))
  const top = Math.min(topInset, Math.max(0, maxY - bottomInset))
  const bottom = Math.min(bottomInset, Math.max(0, maxY - top))
  return {
    left: viewport.x + left,
    top: viewport.y + top,
    right: viewport.x + viewport.width - right,
    bottom: viewport.y + viewport.height - bottom,
  }
}

function computeAxisDelta(targetStart: number, targetEnd: number, bandStart: number, bandEnd: number): number {
  if (targetStart < bandStart) {
    return targetStart - bandStart
  }
  if (targetEnd > bandEnd) {
    return targetEnd - bandEnd
  }
  return 0
}

type FollowAxisDeltaOptions = {
  movement?: ScrollAxisMovement
  target: number
  bandStart: number
  bandEnd: number
}

function computeScrollAxisDelta(options: FollowAxisDeltaOptions): number {
  const targetStart = options.target
  const targetEnd = options.target + 1
  return computeAxisDelta(targetStart, targetEnd, options.bandStart, options.bandEnd)
}

export function computeScrollIntoViewDelta(options: {
  target: ScrollPoint
  band: ScrollBand
  trackX?: boolean
  movement?: ScrollMovement
}): ScrollDelta {
  return {
    x:
      options.trackX === false
        ? 0
        : computeScrollAxisDelta({
            target: options.target.x,
            bandStart: options.band.left,
            bandEnd: options.band.right,
            movement: options.movement?.x,
          }),
    y: computeScrollAxisDelta({
      target: options.target.y,
      bandStart: options.band.top,
      bandEnd: options.band.bottom,
      movement: options.movement?.y,
    }),
  }
}

export function resolveScrollIntoView(
  node: ScrollBoxRenderable | undefined,
  target: ScrollPoint,
  options: ScrollIntoViewOptions = {},
): ScrollIntoViewComputation | null {
  const viewport = getViewportRect(node)
  if (!viewport) {
    return null
  }
  if (viewport.width <= 0 || viewport.height <= 0) {
    return null
  }
  const normalizedTarget = normalizeScrollPoint(target)
  if (!normalizedTarget) {
    return null
  }
  const band = computeViewportBand(viewport, options)
  const delta = computeScrollIntoViewDelta({
    target: normalizedTarget,
    band,
    trackX: options.trackX,
    movement: options.movement,
  })
  return {
    target: normalizedTarget,
    viewport,
    band,
    delta,
  }
}

export function scrollIntoView(
  node: ScrollBoxRenderable | undefined,
  target: ScrollPoint,
  options: ScrollIntoViewOptions = {},
): ScrollIntoViewComputation | null {
  const plan = resolveScrollIntoView(node, target, options)
  if (!plan) {
    return null
  }
  if (plan.delta.x !== 0 || plan.delta.y !== 0) {
    node?.scrollBy(plan.delta)
  }
  return plan
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
