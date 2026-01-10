import type { BoxRenderable, ScrollBoxRenderable } from "@opentui/core"
import type { ScrollDelta } from "./types.ts"

type ScrollBoxWithViewport = ScrollBoxRenderable & { viewport?: BoxRenderable }

const MAX_ENSURE_ATTEMPTS = 5

export type AutoscrollService = {
  setScrollBox(node: ScrollBoxRenderable | undefined): void
  registerRowNode(rowId: string, node: BoxRenderable | undefined): void
  ensureRowVisible(rowId: string | null): void
  scrollBy(delta: ScrollDelta): void
  requestHorizontalReset(): void
  hasPendingHorizontalReset(): boolean
  dispose(): void
}

export function createAutoscrollService(): AutoscrollService {
  const rowNodes = new Map<string, BoxRenderable>()
  let scrollBox: ScrollBoxRenderable | undefined
  let ensureTarget: string | null = null
  let ensureAttempts = 0
  let ensureHandle: ReturnType<typeof setTimeout> | null = null
  let horizontalResetPending = false

  const registerRowNode = (rowId: string, node: BoxRenderable | undefined) => {
    if (!node) {
      rowNodes.delete(rowId)
      return
    }
    rowNodes.set(rowId, node)
    if (ensureTarget === rowId) scheduleEnsureTask()
  }

  const setScrollBox = (node: ScrollBoxRenderable | undefined) => {
    scrollBox = node
    if (!scrollBox) {
      horizontalResetPending = false
      return
    }
    if (horizontalResetPending) requestHorizontalReset()
    if (ensureTarget) scheduleEnsureTask()
  }

  const ensureRowVisible = (rowId: string | null) => {
    ensureTarget = rowId
    ensureAttempts = 0
    if (!rowId) {
      cancelEnsureTask()
      return
    }
    scheduleEnsureTask()
  }

  const scrollBy = (delta: ScrollDelta) => {
    scrollBox?.scrollBy(delta)
  }

  const scheduleEnsureTask = () => {
    if (ensureHandle) return
    ensureHandle = setTimeout(() => {
      ensureHandle = null
      runEnsureVisibleTask()
    }, 0)
  }

  const cancelEnsureTask = () => {
    if (!ensureHandle) return
    clearTimeout(ensureHandle)
    ensureHandle = null
  }

  const runEnsureVisibleTask = () => {
    if (!ensureTarget || !scrollBox) {
      ensureTarget = null
      ensureAttempts = 0
      return
    }
    const node = rowNodes.get(ensureTarget)
    if (!node) {
      if (ensureAttempts >= MAX_ENSURE_ATTEMPTS) {
        ensureTarget = null
        ensureAttempts = 0
        return
      }
      ensureAttempts += 1
      scheduleEnsureTask()
      return
    }
    const viewport = (scrollBox as ScrollBoxWithViewport).viewport
    if (!viewport) {
      ensureTarget = null
      ensureAttempts = 0
      return
    }

    let deltaY = 0
    const nodeTop = node.y
    const nodeBottom = node.y + node.height
    const viewportTop = viewport.y
    const viewportBottom = viewport.y + viewport.height
    if (nodeTop < viewportTop) deltaY = nodeTop - viewportTop
    else if (nodeBottom > viewportBottom) deltaY = nodeBottom - viewportBottom

    if (deltaY !== 0) scrollBox.scrollBy({ x: 0, y: deltaY })
    ensureTarget = null
    ensureAttempts = 0
  }

  const tryResetHorizontalScroll = () => {
    if (!scrollBox) return false
    const viewportWidth = scrollBox.viewport?.width ?? 0
    if (viewportWidth === 0) return false
    if (scrollBox.scrollLeft === 0) return true
    scrollBox.scrollLeft = 0
    return true
  }

  const requestHorizontalReset = () => {
    if (!scrollBox) {
      horizontalResetPending = true
      return
    }
    horizontalResetPending = !tryResetHorizontalScroll()
  }

  const hasPendingHorizontalReset = () => horizontalResetPending

  const dispose = () => {
    if (ensureHandle) {
      clearTimeout(ensureHandle)
      ensureHandle = null
    }
    rowNodes.clear()
    ensureTarget = null
    horizontalResetPending = false
  }

  return {
    setScrollBox,
    registerRowNode,
    ensureRowVisible,
    scrollBy,
    requestHorizontalReset,
    hasPendingHorizontalReset,
    dispose,
  }
}
