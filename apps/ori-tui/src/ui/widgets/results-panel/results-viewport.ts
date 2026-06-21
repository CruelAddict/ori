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
    updateFromScrollbox()
  }

  const reset = () => {
    setScrollLeft(tableX(0))
    setScrollTop(visualRow(0))
    ref?.scrollTo({ x: 0, y: 0 })
  }

  const visibleRows = createMemo(() => {
    const grid = options.grid()
    return grid ? grid.visibleRows(scrollTop(), height(), overscan) : []
  })

  const metricHeight = createMemo(() => Math.max(height(), options.grid()?.totalVisualRows ?? 0))
  const metricWidth = createMemo(() => Math.max(width(), options.grid()?.totalWidth ?? 0))

  const debugSnapshot = () => {
    const grid = options.grid()
    const rows = visibleRows()
    const viewport = ref ? getViewportRect(ref) : null
    const scrollbox = ref
      ? {
          scrollLeft: ref.scrollLeft ?? 0,
          scrollTop: ref.scrollTop ?? 0,
          scrollWidth: ref.scrollWidth,
          scrollHeight: ref.scrollHeight,
          maxScrollLeft: Math.max(0, ref.scrollWidth - ref.viewport.width),
          maxScrollTop: Math.max(0, ref.scrollHeight - ref.viewport.height),
          viewport,
          content: {
            x: ref.content.x,
            y: ref.content.y,
            width: ref.content.width,
            height: ref.content.height,
            translateX: ref.content.translateX,
            translateY: ref.content.translateY,
          },
          horizontalScrollbar: {
            visible: ref.horizontalScrollBar.visible,
            position: ref.horizontalScrollBar.scrollPosition,
            size: ref.horizontalScrollBar.scrollSize,
            viewportSize: ref.horizontalScrollBar.viewportSize,
          },
          verticalScrollbar: {
            visible: ref.verticalScrollBar.visible,
            position: ref.verticalScrollBar.scrollPosition,
            size: ref.verticalScrollBar.scrollSize,
            viewportSize: ref.verticalScrollBar.viewportSize,
          },
        }
      : null

    return {
      attached: Boolean(ref),
      scrollLeft: scrollLeft(),
      scrollTop: scrollTop(),
      width: width(),
      height: height(),
      metricWidth: metricWidth(),
      metricHeight: metricHeight(),
      overscan,
      grid: grid
        ? {
            rowCount: grid.rowCount(),
            columnCount: grid.columnCount(),
            totalWidth: grid.totalWidth,
            totalVisualRows: grid.totalVisualRows,
          }
        : null,
      visibleRows: rows.map((item) => ({
        row: item.row,
        rowNumber: Number(item.row) + 1,
        top: item.top,
        height: item.height,
        renderedTop: item.top - scrollTop(),
      })),
      scrollbox,
    }
  }

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
    debugSnapshot,
    nativeSelection: () => ref?.ctx.getSelection() ?? null,
    cellAtScreenPoint,
    scrollCellIntoView,
    scrollHorizontally,
  }
}
