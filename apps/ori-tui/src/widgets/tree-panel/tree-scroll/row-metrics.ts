import { createSignal } from "solid-js"

export const MIN_VIEWPORT_WIDTH = 20

export type RowDescriptor = {
  id: string
  depth: number
}

export type MeasureRowWidth = (row: RowDescriptor) => number

type WidthChangeHandler = (contentWidth: number) => void
type WidthEntry = { id: string; width: number }
type RowMeta = { depth: number; width: number }

export type RowMetricsService = {
  syncRows(rows: readonly RowDescriptor[]): void
  contentWidth: () => number
  naturalWidth: () => number
  dispose(): void
}

/* the reason this file exists is that opentui can't properly handle scrollbar
 * when content & viewport both change widths; the scrollbar sizing gets broken
 * and I was not in the mood to debug it; as a result, we have this component
 * that dynamically resizes scrollbox's underlying content in a controllable way
 * for tiptoeing around that scrollbar size bug */
export function createRowMetrics(
  measureRowWidth: MeasureRowWidth,
  onWidthUpdate: WidthChangeHandler,
): RowMetricsService {
  const rowWidths = new Map<string, RowMeta>()
  const depthStats = new Map<number, WidthEntry>()
  const activeRowIds = new Set<string>()
  const [contentWidth, setContentWidth] = createSignal(MIN_VIEWPORT_WIDTH)
  const [naturalWidth, setNaturalWidth] = createSignal(MIN_VIEWPORT_WIDTH)

  let minContentWidth = Math.max(readTerminalWidth() - 30, MIN_VIEWPORT_WIDTH)
  let widthRecalcHandle: ReturnType<typeof setTimeout> | null = null
  let pendingWidthUpdate = false

  const syncRows = (rows: readonly RowDescriptor[]) => {
    activeRowIds.clear()
    for (const row of rows) {
      activeRowIds.add(row.id)
      if (!rowWidths.has(row.id)) {
        upsertRowWidth(row)
      }
    }
    const removed: string[] = []
    for (const id of rowWidths.keys()) {
      if (!activeRowIds.has(id)) removed.push(id)
    }
    for (const id of removed) removeRowWidth(id)
    scheduleWidthRecalc()
  }

  const upsertRowWidth = (row: RowDescriptor) => {
    const width = measureRowWidth(row)
    const current = rowWidths.get(row.id)
    rowWidths.set(row.id, { depth: row.depth, width })
    const depthEntry = depthStats.get(row.depth)
    if (!depthEntry || width >= depthEntry.width) {
      depthStats.set(row.depth, { id: row.id, width })
    } else if (current && depthEntry.id === row.id && width < depthEntry.width) {
      recalcDepth(row.depth)
    }
  }

  const removeRowWidth = (rowId: string) => {
    const meta = rowWidths.get(rowId)
    if (!meta) return
    rowWidths.delete(rowId)
    const depthEntry = depthStats.get(meta.depth)
    if (depthEntry?.id === rowId) recalcDepth(meta.depth)
    scheduleWidthRecalc()
  }

  const recalcDepth = (depth: number) => {
    let best: WidthEntry | undefined
    for (const [rowId, meta] of rowWidths.entries()) {
      if (meta.depth !== depth) continue
      if (!best || meta.width > best.width) best = { id: rowId, width: meta.width }
    }
    if (best) depthStats.set(depth, best)
    else depthStats.delete(depth)
  }

  const scheduleWidthRecalc = () => {
    if (pendingWidthUpdate) return
    pendingWidthUpdate = true
    widthRecalcHandle = setTimeout(() => {
      pendingWidthUpdate = false
      widthRecalcHandle = null
      let widest = MIN_VIEWPORT_WIDTH
      for (const { width } of depthStats.values()) {
        if (width > widest) widest = width
      }
      emitWidthChange(widest)
    }, 0)
  }

  const emitWidthChange = (widest: number) => {
    setNaturalWidth(widest)
    const applied = Math.max(widest, minContentWidth)
    setContentWidth(applied)
    onWidthUpdate(applied)
  }

  const handleViewportResize = () => {
    const normalized = Math.max(readTerminalWidth() - 30, MIN_VIEWPORT_WIDTH)
    if (normalized === minContentWidth) return
    minContentWidth = normalized
    emitWidthChange(naturalWidth())
  }

  process.stdout?.on?.("resize", handleViewportResize)
  emitWidthChange(naturalWidth())

  const dispose = () => {
    process.stdout?.off?.("resize", handleViewportResize)
    if (widthRecalcHandle) {
      clearTimeout(widthRecalcHandle)
      widthRecalcHandle = null
    }
    activeRowIds.clear()
    rowWidths.clear()
    depthStats.clear()
  }

  return {
    syncRows,
    contentWidth,
    naturalWidth,
    dispose,
  }
}

function readTerminalWidth() {
  if (typeof process === "undefined") return 0
  const columns = process.stdout?.columns
  return columns ?? 0
}
