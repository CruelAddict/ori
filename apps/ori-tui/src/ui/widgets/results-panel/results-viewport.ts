import type { ScrollBoxRenderable } from "@opentui/core"
import { getViewportRect } from "@ui/components/ori-scrollbox"
import { type Accessor, batch, createMemo, createSignal, untrack } from "solid-js"
import { type CellRef, type ResultsGrid, tableX, visualRow, visualRowHeight } from "./results-grid"

const DEFAULT_OVERSCAN = 4

export type ResultsViewport = ReturnType<typeof createResultsViewport>

export function createResultsViewport(options: { grid: Accessor<ResultsGrid | null>; overscan?: number }) {
  let ref: ScrollBoxRenderable | undefined
  const overscan = options.overscan ?? DEFAULT_OVERSCAN
  const [scrollLeft, setScrollLeft] = createSignal(tableX(0))
  const [scrollTop, setScrollTop] = createSignal(visualRow(0))
  const [width, setWidth] = createSignal(0)
  const [height, setHeight] = createSignal(visualRowHeight(1))

  const updateFromScrollbox = () => {
    if (!ref) return

    ref.content.translateY = 0
    const viewport = getViewportRect(ref)
    const left = tableX(ref.scrollLeft ?? 0)
    const top = visualRow(ref.scrollTop ?? 0)
    batch(() => {
      if (untrack(scrollLeft) !== left) setScrollLeft(left)
      if (untrack(scrollTop) !== top) setScrollTop(top)
      if (untrack(width) !== viewport.width) setWidth(viewport.width)
      if (untrack(height) !== viewport.height) setHeight(visualRowHeight(Math.max(1, viewport.height)))
    })
  }

  const attach = (node: ScrollBoxRenderable | undefined) => {
    ref = node
    if (!ref) return
    ref.content.translateY = 0
    updateFromScrollbox()
  }

  const reset = () => {
    setScrollLeft(tableX(0))
    setScrollTop(visualRow(0))
    ref?.scrollTo({ x: 0, y: 0 })
    if (ref) {
      ref.content.translateY = 0
    }
  }

  const visibleRows = createMemo(() => {
    const grid = options.grid()
    return grid ? grid.visibleRows(scrollTop(), height(), overscan) : []
  })

  const metricHeight = createMemo(() => Math.max(height(), options.grid()?.totalVisualRows ?? 0))
  const metricWidth = createMemo(() => Math.max(width(), options.grid()?.totalWidth ?? 0))

  const cellAtScreenPoint = (point: { x: number; y: number }): CellRef | null => {
    const grid = options.grid()
    if (!grid || !ref) return null

    const viewport = getViewportRect(ref)
    const x = tableX(point.x - viewport.x + scrollLeft())
    if (point.y < viewport.y) {
      return grid.headerCellAt(x)
    }

    return grid.bodyCellAt(x, visualRow(point.y - viewport.y + scrollTop()))
  }

  const scrollCellIntoView = (cell: CellRef) => {
    const grid = options.grid()
    if (!grid || !ref) return

    const currentTop = ref.scrollTop ?? 0
    const currentLeft = ref.scrollLeft ?? 0
    const viewportHeight = Math.max(1, getViewportRect(ref).height)
    const viewportWidth = Math.max(1, getViewportRect(ref).width)
    let nextTop = currentTop
    let nextLeft = currentLeft

    if (cell.kind === "body") {
      const row = grid.rowVisualRange(cell.row)
      if (row.top < currentTop) {
        nextTop = row.top
      }
      if (row.top + row.height > currentTop + viewportHeight) {
        nextTop = row.top + row.height - viewportHeight
      }
    }

    const col = grid.columnRanges[cell.col]
    if (col) {
      if (col.end > currentLeft + viewportWidth) {
        nextLeft = col.end - viewportWidth
      }
      if (col.start < currentLeft) {
        nextLeft = col.start
      }
    }

    if (nextTop !== currentTop || nextLeft !== currentLeft) {
      ref.scrollTo({ x: nextLeft, y: nextTop })
      updateFromScrollbox()
    }
  }

  const scrollHorizontally = (delta: number) => {
    ref?.scrollBy({ x: delta, y: 0 })
    updateFromScrollbox()
  }

  return {
    attach,
    updateFromScrollbox,
    reset,
    scrollLeft,
    scrollTop,
    width,
    height,
    metricHeight,
    metricWidth,
    visibleRows,
    nativeSelection: () => ref?.ctx.getSelection() ?? null,
    cellAtScreenPoint,
    scrollCellIntoView,
    scrollHorizontally,
  }
}
