import type { MouseEvent, ScrollBoxRenderable } from "@opentui/core"
import { useLogger } from "@ui/providers/logger"
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

export type FollowSource = "target-change" | "viewport-resize" | "manual-scroll"

type FollowBand = {
  left: number
  top: number
  right: number
  bottom: number
}

export type FollowOutOfBandContext = {
  source: FollowSource
  target: FollowPoint
  band: FollowBand
  delta: {
    x: number
    y: number
  }
}

type FollowDecision = "autoscroll" | "handled"

export type FollowTargetConfig = {
  target: Accessor<FollowPoint | null>
  scrolloffY?: number | Accessor<number>
  trackX?: boolean
  manual?: boolean
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

const DEFAULT_FOLLOW_SCROLLOFF_Y = cursorScrolloffY

type ViewportSnapshot = {
  viewportX: number
  viewportY: number
  scrollLeft: number
  scrollTop: number
  viewportWidth: number
  viewportHeight: number
}

type ViewportRect = {
  x: number
  y: number
  width: number
  height: number
}

type FollowMovement = {
  x: -1 | 0 | 1
  y: -1 | 0 | 1
}

export function OriScrollbox(props: OriScrollboxProps) {
  const { theme } = useTheme()
  const logger = useLogger()
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
  let previousFollowTargetContent: FollowPoint | null = null
  let previousFollowTargetViewport: FollowPoint | null = null
  let pendingProgrammaticScrollEvents = 0
  let pendingManualFollowRecheck = false

  const logFollow = (event: string, payload: Record<string, unknown>) => {
    logger.debug(payload, `scroll-follow:${event}`)
  }

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
    if (source !== "manual-scroll") {
      return true
    }
    return follow.manual ?? false
  }

  const runFollow = (source: FollowSource, targetOverride?: FollowPoint | null, movement?: FollowMovement) => {
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
    const scrolloffY = normalizeScrolloffValue(resolveFollowScrolloffY(follow.scrolloffY))
    const band = computeViewportBand(viewport, scrolloffY)
    const trackX = follow.trackX ?? true
    const delta = {
      x: trackX
        ? computeFollowAxisDelta({
            source,
            movement: movement?.x,
            target: target.x,
            bandStart: band.left,
            bandEnd: band.right,
          })
        : 0,
      y: computeFollowAxisDelta({
        source,
        movement: movement?.y,
        target: target.y,
        bandStart: band.top,
        bandEnd: band.bottom,
      }),
    }
    logFollow("run", {
      source,
      movement,
      target,
      band,
      delta,
      trackX,
      scrollTop: scrollBoxRef.scrollTop ?? 0,
      scrollLeft: scrollBoxRef.scrollLeft ?? 0,
      pendingProgrammaticScrollEvents,
      pendingManualFollowRecheck,
    })
    if (delta.x === 0 && delta.y === 0) {
      logFollow("run-no-delta", {
        source,
        target,
        band,
      })
      return
    }

    const decision =
      follow.onOutOfBand?.({
        source,
        target,
        band,
        delta,
      }) ?? "autoscroll"
    if (decision === "handled") {
      logFollow("run-handled", {
        source,
        target,
        band,
        delta,
      })
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
    logFollow("run-autoscroll", {
      source,
      target,
      band,
      delta,
      prevLeft,
      prevTop,
      nextLeft,
      nextTop,
      pendingProgrammaticScrollEvents,
    })
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
    const previousViewportTarget = previousFollowTargetViewport
    const target = getNormalizedFollowTarget()
    const targetContent = toContentTargetPoint(target, nextSnapshot)
    const targetMoved = !isSameFollowPoint(previousTarget, targetContent)
    const targetMovement = computeFollowMovement(previousTarget, targetContent)
    previousFollowTargetContent = targetContent
    previousFollowTargetViewport = target
    const viewportTargetMovement = computeFollowMovement(previousViewportTarget, target)
    const targetContentDelta = {
      x: (targetContent?.x ?? 0) - (previousTarget?.x ?? 0),
      y: (targetContent?.y ?? 0) - (previousTarget?.y ?? 0),
    }
    const targetViewportDelta = {
      x: (target?.x ?? 0) - (previousViewportTarget?.x ?? 0),
      y: (target?.y ?? 0) - (previousViewportTarget?.y ?? 0),
    }
    const handledProgrammaticScroll = scrollMoved && pendingProgrammaticScrollEvents > 0
    logFollow("sync", {
      prevSnapshot,
      nextSnapshot,
      viewportResized,
      scrollMoved,
      previousTarget,
      target,
      targetContent,
      targetMoved,
      targetMovement,
      viewportTargetMovement,
      targetContentDelta,
      targetViewportDelta,
      pendingProgrammaticScrollEvents,
      pendingManualFollowRecheck,
      handledProgrammaticScroll,
    })
    if (scrollMoved && pendingProgrammaticScrollEvents > 0) {
      pendingProgrammaticScrollEvents -= 1
    }
    if (viewportResized) {
      logFollow("dispatch", {
        reason: "viewport-resize",
        target,
      })
      runFollow("viewport-resize", target)
      return
    }
    if (scrollMoved && handledProgrammaticScroll) {
      pendingManualFollowRecheck = false
      logFollow("dispatch-skip", {
        reason: "programmatic-scroll-ack",
      })
      return
    }
    if (targetMoved) {
      pendingManualFollowRecheck = false
      logFollow("dispatch", {
        reason: "target-change",
        source: scrollMoved ? "target-change-on-scroll" : "target-change",
        target,
        targetContent,
        targetMovement,
      })
      runFollow("target-change", target, targetMovement)
      return
    }
    if (scrollMoved) {
      if (pendingProgrammaticScrollEvents > 0) {
        logFollow("dispatch-skip", {
          reason: "programmatic-scroll-pending",
        })
        return
      }
      pendingManualFollowRecheck = true
      logFollow("dispatch", {
        reason: "manual-scroll",
        target,
      })
      runFollow("manual-scroll", target)
      return
    }
    if (pendingManualFollowRecheck) {
      pendingManualFollowRecheck = false
      logFollow("dispatch", {
        reason: "manual-recheck",
        target,
      })
      runFollow("manual-scroll", target)
      return
    }
  }

  createEffect(() => {
    if (!follow) {
      previousFollowTargetContent = null
      previousFollowTargetViewport = null
      pendingManualFollowRecheck = false
      return
    }
    resolveFollowScrolloffY(follow.scrolloffY)
    logFollow("effect", {
      followEnabled: true,
    })
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
      previousFollowTargetViewport = null
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
    previousFollowTargetContent = toContentTargetPoint(target, previousViewportSnapshot)
    previousFollowTargetViewport = target
    logFollow("ready", {
      snapshot: previousViewportSnapshot,
      target,
      targetContent: previousFollowTargetContent,
    })
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

function getViewportRect(node: ScrollBoxRenderable): ViewportRect | undefined {
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

function normalizeFollowTarget(target: FollowPoint): FollowPoint | null {
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

function resolveFollowScrolloffY(value: number | Accessor<number> | undefined): number {
  if (typeof value === "function") {
    return value()
  }
  if (value !== undefined) {
    return value
  }
  return DEFAULT_FOLLOW_SCROLLOFF_Y
}

function normalizeScrolloffValue(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.floor(value))
}

function computeViewportBand(viewport: ViewportRect, scrolloffY: number): FollowBand {
  const maxY = Math.floor((viewport.height - 1) / 2)
  const insetY = Math.min(scrolloffY, Math.max(0, maxY))
  return {
    left: viewport.x,
    top: viewport.y + insetY,
    right: viewport.x + viewport.width,
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
  target: number
  bandStart: number
  bandEnd: number
}

function computeFollowAxisDelta(options: FollowAxisDeltaOptions): number {
  const targetStart = options.target
  const targetEnd = options.target + 1
  if (options.source !== "target-change") {
    return computeAxisDelta(targetStart, targetEnd, options.bandStart, options.bandEnd)
  }
  if (options.movement === 1) {
    if (targetEnd > options.bandEnd) {
      return targetEnd - options.bandEnd
    }
    return 0
  }
  if (options.movement === -1) {
    if (targetStart < options.bandStart) {
      return targetStart - options.bandStart
    }
    return 0
  }

  return computeAxisDelta(targetStart, targetEnd, options.bandStart, options.bandEnd)
}

function toContentTargetPoint(target: FollowPoint | null, viewport: ViewportSnapshot | undefined): FollowPoint | null {
  if (!target || !viewport) {
    return null
  }
  return {
    x: target.x - viewport.viewportX + viewport.scrollLeft,
    y: target.y - viewport.viewportY + viewport.scrollTop,
  }
}

function computeFollowMovement(previous: FollowPoint | null, next: FollowPoint | null): FollowMovement {
  if (!previous || !next) {
    return { x: 0, y: 0 }
  }
  return {
    x: computeAxisMovement(previous.x, next.x),
    y: computeAxisMovement(previous.y, next.y),
  }
}

function computeAxisMovement(previous: number, next: number): -1 | 0 | 1 {
  if (next > previous) {
    return 1
  }
  if (next < previous) {
    return -1
  }
  return 0
}

function isSameFollowPoint(a: FollowPoint | null, b: FollowPoint | null): boolean {
  if (!a && !b) {
    return true
  }
  if (!a || !b) {
    return false
  }
  return a.x === b.x && a.y === b.y
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
