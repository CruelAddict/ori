import type { MouseEvent, ScrollBoxRenderable } from "@opentui/core"
import { useTheme } from "@ui/providers/theme"
import { cursorScrolloffY } from "@ui/services/scroll-follow-settings"
import { type Accessor, createEffect, type JSX } from "solid-js"

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

export type FollowRect = {
  x: number
  y: number
  width: number
  height: number
}

export type FollowTarget = FollowPoint | FollowRect

export type FollowScrolloff =
  | number
  | {
      x?: number
      y?: number
    }

export type FollowSource = "target-change" | "viewport-resize" | "manual-scroll"

type FollowAxes = {
  x?: boolean
  y?: boolean
}

type FollowSources = {
  targetChange?: boolean
  viewportResize?: boolean
  manualScroll?: boolean
}

type FollowBand = {
  left: number
  top: number
  right: number
  bottom: number
}

export type FollowOutOfBandContext = {
  source: FollowSource
  target: FollowRect
  viewport: FollowRect
  band: FollowBand
  delta: {
    x: number
    y: number
  }
}

type FollowDecision = "autoscroll" | "handled"

export type FollowTargetConfig = {
  target: Accessor<FollowTarget | null>
  scrolloff?: FollowScrolloff | Accessor<FollowScrolloff>
  axes?: FollowAxes
  sources?: FollowSources
  onOutOfBand?: (context: FollowOutOfBandContext) => FollowDecision
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
  follow?: FollowTargetConfig
}

const DEFAULT_FOLLOW_SCROLLOFF = { x: 0, y: cursorScrolloffY }
const DEFAULT_FOLLOW_SOURCES: Required<FollowSources> = {
  targetChange: true,
  viewportResize: true,
  manualScroll: false,
}

const DEFAULT_FOLLOW_AXES: Required<FollowAxes> = {
  x: true,
  y: true,
}

type ViewportSnapshot = {
  viewportX: number
  viewportY: number
  scrollLeft: number
  scrollTop: number
  viewportWidth: number
  viewportHeight: number
}

type FollowMovement = {
  x: -1 | 0 | 1
  y: -1 | 0 | 1
}

export function OriScrollbox(props: OriScrollboxProps) {
  const { theme } = useTheme()
  const {
    onReady,
    minHorizontalThumbWidth,
    scrollSpeed,
    onSync,
    follow,
    children,
    scrollX,
    scrollY,
    horizontalScrollbarOptions,
    verticalScrollbarOptions,
    ...scrollboxProps
  } = props

  let scrollBoxRef: ScrollBoxRenderable | undefined
  let previousViewportSnapshot: ViewportSnapshot | undefined
  let previousFollowTargetContent: FollowRect | null = null
  let pendingProgrammaticScrollEvents = 0
  let pendingManualFollowRecheck = false

  const getNormalizedFollowTarget = () => {
    if (!follow) {
      return null
    }
    const value = follow.target()
    if (!value) {
      return null
    }
    return normalizeFollowTarget(value)
  }

  const shouldHandleSource = (source: FollowSource) => {
    if (!follow) {
      return false
    }
    const configuredSources = {
      ...DEFAULT_FOLLOW_SOURCES,
      ...(follow.sources ?? {}),
    }
    if (source === "target-change") {
      return configuredSources.targetChange
    }
    if (source === "viewport-resize") {
      return configuredSources.viewportResize
    }
    return configuredSources.manualScroll
  }

  const runFollow = (source: FollowSource, targetOverride?: FollowRect | null, movement?: FollowMovement) => {
    if (!follow || !scrollBoxRef) {
      return
    }
    if (!shouldHandleSource(source)) {
      return
    }
    const viewport = getViewportRect(scrollBoxRef)
    if (!viewport) {
      return
    }
    if (viewport.width <= 0 || viewport.height <= 0) {
      return
    }
    const target = targetOverride ?? getNormalizedFollowTarget()
    if (!target) {
      return
    }
    const scrolloff = normalizeFollowScrolloff(resolveFollowScrolloff(follow.scrolloff))
    const axes = resolveFollowAxes(follow.axes)
    const band = computeViewportBand(viewport, scrolloff)
    const delta = {
      x: axes.x
        ? computeFollowAxisDelta({
            source,
            movement: movement?.x,
            targetStart: target.x,
            targetEnd: target.x + target.width,
            bandStart: band.left,
            bandEnd: band.right,
          })
        : 0,
      y: axes.y
        ? computeFollowAxisDelta({
            source,
            movement: movement?.y,
            targetStart: target.y,
            targetEnd: target.y + target.height,
            bandStart: band.top,
            bandEnd: band.bottom,
          })
        : 0,
    }
    if (delta.x === 0 && delta.y === 0) {
      return
    }

    const decision =
      follow.onOutOfBand?.({
        source,
        target,
        viewport,
        band,
        delta,
      }) ?? "autoscroll"
    if (decision === "handled") {
      return
    }

    const prevLeft = scrollBoxRef.scrollLeft ?? 0
    const prevTop = scrollBoxRef.scrollTop ?? 0
    scrollBoxRef.scrollBy(delta)
    const nextLeft = scrollBoxRef.scrollLeft ?? 0
    const nextTop = scrollBoxRef.scrollTop ?? 0
    if (nextLeft !== prevLeft || nextTop !== prevTop) {
      pendingProgrammaticScrollEvents += 1
    }
  }

  const syncFollowFromViewport = () => {
    if (!follow || !scrollBoxRef) {
      return
    }
    const nextSnapshot = captureViewportSnapshot(scrollBoxRef)
    const prevSnapshot = previousViewportSnapshot
    previousViewportSnapshot = nextSnapshot
    if (!prevSnapshot) {
      return
    }

    const viewportResized =
      prevSnapshot.viewportWidth !== nextSnapshot.viewportWidth ||
      prevSnapshot.viewportHeight !== nextSnapshot.viewportHeight
    const scrollMoved =
      prevSnapshot.scrollLeft !== nextSnapshot.scrollLeft || prevSnapshot.scrollTop !== nextSnapshot.scrollTop
    const previousTarget = previousFollowTargetContent
    const target = getNormalizedFollowTarget()
    const targetContent = toContentTargetRect(target, nextSnapshot)
    const targetMoved = !isSameFollowRect(previousTarget, targetContent)
    const targetMovement = computeFollowMovement(previousTarget, targetContent)
    previousFollowTargetContent = targetContent
    const handledProgrammaticScroll = scrollMoved && pendingProgrammaticScrollEvents > 0
    if (scrollMoved && pendingProgrammaticScrollEvents > 0) {
      pendingProgrammaticScrollEvents -= 1
    }
    if (viewportResized) {
      runFollow("viewport-resize", target)
      return
    }
    if (scrollMoved && handledProgrammaticScroll) {
      pendingManualFollowRecheck = false
      return
    }
    if (targetMoved) {
      pendingManualFollowRecheck = false
      runFollow("target-change", target, targetMovement)
      return
    }
    if (scrollMoved) {
      if (pendingProgrammaticScrollEvents > 0) {
        return
      }
      pendingManualFollowRecheck = true
      runFollow("manual-scroll", target)
      return
    }
    if (pendingManualFollowRecheck) {
      pendingManualFollowRecheck = false
      runFollow("manual-scroll", target)
      return
    }
  }

  createEffect(() => {
    if (!follow) {
      previousFollowTargetContent = null
      pendingManualFollowRecheck = false
      return
    }
    resolveFollowScrolloff(follow.scrolloff)
    const snapshot = scrollBoxRef ? captureViewportSnapshot(scrollBoxRef) : undefined
    const target = getNormalizedFollowTarget()
    previousFollowTargetContent = toContentTargetRect(target, snapshot)
    runFollow("target-change", target)
  })

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
    scrollBoxRef = node
    onReady?.(node)
    if (!node) {
      previousViewportSnapshot = undefined
      previousFollowTargetContent = null
      pendingProgrammaticScrollEvents = 0
      pendingManualFollowRecheck = false
      return
    }

    enforceStableScrollboxOverflowLayout(node)

    if (typeof minHorizontalThumbWidth === "number") {
      enforceHorizontalScrollbarMinThumbWidth(node, minHorizontalThumbWidth)
    }

    previousViewportSnapshot = captureViewportSnapshot(node)
    const target = getNormalizedFollowTarget()
    previousFollowTargetContent = toContentTargetRect(target, previousViewportSnapshot)
    runFollow("target-change", target)

    if (!scrollSpeed && !onSync && !follow) {
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
      syncFollowFromViewport()
      onSync?.()
    }

    // @ts-expect-error onMouseEvent is protected in typings
    node.onMouseEvent = (event: MouseEvent) => {
      handleMouseEvent?.(event)
      syncFollowFromViewport()
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

function captureViewportSnapshot(node: ScrollBoxRenderable): ViewportSnapshot {
  const viewport = getViewportRect(node)
  return {
    viewportX: viewport?.x ?? 0,
    viewportY: viewport?.y ?? 0,
    scrollLeft: node.scrollLeft ?? 0,
    scrollTop: node.scrollTop ?? 0,
    viewportWidth: viewport?.width ?? 0,
    viewportHeight: viewport?.height ?? 0,
  }
}

function getViewportRect(node: ScrollBoxRenderable): FollowRect | undefined {
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

function normalizeFollowTarget(target: FollowTarget): FollowRect | null {
  if (isFollowRect(target)) {
    const x = toFiniteNumber(target.x)
    const y = toFiniteNumber(target.y)
    const width = toFiniteNumber(target.width)
    const height = toFiniteNumber(target.height)
    if (x === undefined || y === undefined || width === undefined || height === undefined) {
      return null
    }
    if (width <= 0 || height <= 0) {
      return null
    }
    return {
      x: Math.floor(x),
      y: Math.floor(y),
      width: Math.floor(width),
      height: Math.floor(height),
    }
  }
  const x = toFiniteNumber(target.x)
  const y = toFiniteNumber(target.y)
  if (x === undefined || y === undefined) {
    return null
  }
  return {
    x: Math.floor(x),
    y: Math.floor(y),
    width: 1,
    height: 1,
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

function isFollowRect(target: FollowTarget): target is FollowRect {
  return "width" in target && "height" in target
}

function resolveFollowScrolloff(value: FollowScrolloff | Accessor<FollowScrolloff> | undefined): FollowScrolloff {
  if (typeof value === "function") {
    return value()
  }
  if (value !== undefined) {
    return value
  }
  return DEFAULT_FOLLOW_SCROLLOFF
}

function resolveFollowAxes(value: FollowAxes | undefined): Required<FollowAxes> {
  if (!value) {
    return DEFAULT_FOLLOW_AXES
  }
  return {
    x: value.x ?? DEFAULT_FOLLOW_AXES.x,
    y: value.y ?? DEFAULT_FOLLOW_AXES.y,
  }
}

function normalizeFollowScrolloff(value: FollowScrolloff | undefined): { x: number; y: number } {
  if (typeof value === "number") {
    const bounded = normalizeScrolloffValue(value)
    return { x: bounded, y: bounded }
  }
  if (!value) {
    return DEFAULT_FOLLOW_SCROLLOFF
  }
  return {
    x: normalizeScrolloffValue(value.x ?? DEFAULT_FOLLOW_SCROLLOFF.x),
    y: normalizeScrolloffValue(value.y ?? DEFAULT_FOLLOW_SCROLLOFF.y),
  }
}

function normalizeScrolloffValue(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.floor(value))
}

function computeViewportBand(viewport: FollowRect, scrolloff: { x: number; y: number }): FollowBand {
  const maxX = Math.floor((viewport.width - 1) / 2)
  const maxY = Math.floor((viewport.height - 1) / 2)
  const insetX = Math.min(scrolloff.x, Math.max(0, maxX))
  const insetY = Math.min(scrolloff.y, Math.max(0, maxY))
  return {
    left: viewport.x + insetX,
    top: viewport.y + insetY,
    right: viewport.x + viewport.width - insetX,
    bottom: viewport.y + viewport.height - insetY,
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
  source: FollowSource
  movement?: -1 | 0 | 1
  targetStart: number
  targetEnd: number
  bandStart: number
  bandEnd: number
}

function computeFollowAxisDelta(options: FollowAxisDeltaOptions): number {
  if (options.source !== "target-change") {
    return computeAxisDelta(options.targetStart, options.targetEnd, options.bandStart, options.bandEnd)
  }
  if (options.movement === 1) {
    if (options.targetEnd > options.bandEnd) {
      return options.targetEnd - options.bandEnd
    }
    return 0
  }
  if (options.movement === -1) {
    if (options.targetStart < options.bandStart) {
      return options.targetStart - options.bandStart
    }
    return 0
  }

  return computeAxisDelta(options.targetStart, options.targetEnd, options.bandStart, options.bandEnd)
}

function toContentTargetRect(target: FollowRect | null, viewport: ViewportSnapshot | undefined): FollowRect | null {
  if (!target || !viewport) {
    return null
  }
  return {
    x: target.x - viewport.viewportX + viewport.scrollLeft,
    y: target.y - viewport.viewportY + viewport.scrollTop,
    width: target.width,
    height: target.height,
  }
}

function computeFollowMovement(previous: FollowRect | null, next: FollowRect | null): FollowMovement {
  if (!previous || !next) {
    return { x: 0, y: 0 }
  }
  return {
    x: computeAxisMovement(previous.x, previous.x + previous.width, next.x, next.x + next.width),
    y: computeAxisMovement(previous.y, previous.y + previous.height, next.y, next.y + next.height),
  }
}

function computeAxisMovement(
  previousStart: number,
  previousEnd: number,
  nextStart: number,
  nextEnd: number,
): -1 | 0 | 1 {
  const movedForward = nextStart > previousStart || nextEnd > previousEnd
  const movedBackward = nextStart < previousStart || nextEnd < previousEnd
  if (movedForward && !movedBackward) {
    return 1
  }
  if (movedBackward && !movedForward) {
    return -1
  }
  return 0
}

function isSameFollowRect(a: FollowRect | null, b: FollowRect | null): boolean {
  if (!a && !b) {
    return true
  }
  if (!a || !b) {
    return false
  }
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
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
