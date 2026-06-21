import type { KeyEvent, MouseEvent, Selection as OpenTuiSelection, ScrollBoxRenderable } from "@opentui/core"
import { getViewportRect } from "@ui/components/ori-scrollbox"
import type { KeyBinding } from "@ui/services/key-scopes"
import { setSelectionOverride } from "@utils/clipboard"
import { type Accessor, batch, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js"
import {
  type CellRef,
  createOriTableGeometry,
  type SeparatorRef,
  type TableCol,
  type TableRow,
  tableCol,
  tableRow,
  tableX,
  type VisibleTableRow,
  type VisualRow,
  type VisualRowHeight,
  visualRow,
  visualRowHeight,
} from "./ori-table-geometry"
import { type CellSelection, cellSelectionRange, isCellSelected, isSeparatorSelected } from "./ori-table-selection"

const DEFAULT_OVERSCAN = 4
const HORIZONTAL_SCROLL_STEP = 6

export type OriTableColumn = {
  name: string
}

type TableSelectionState = {
  start: CellRef
  end: CellRef | null
}

type CreateOriTableVMOptions = {
  columns: Accessor<OriTableColumn[]>
  rows: Accessor<unknown[][]>
  isFocused: Accessor<boolean>
  focusSelf: () => void
  overscan?: number
}

export type OriTableVM = ReturnType<typeof createOriTableVM>

export function createOriTableVM(options: CreateOriTableVMOptions) {
  let scrollbox: ScrollBoxRenderable | undefined
  const overscan = options.overscan ?? DEFAULT_OVERSCAN
  const [cursorRow, setCursorRow] = createSignal(0)
  const [cursorCol, setCursorCol] = createSignal(0)
  const [selection, setSelection] = createSignal<TableSelectionState | null>(null)
  const [scrollLeft, setScrollLeft] = createSignal(tableX(0))
  const [scrollTop, setScrollTop] = createSignal(visualRow(0))
  const [width, setWidth] = createSignal(0)
  const [height, setHeight] = createSignal(visualRowHeight(1))

  const columnWidths = createMemo(() => buildColumnWidths(options.columns(), options.rows()))
  const geometry = createMemo(() =>
    createOriTableGeometry({ columnWidths: columnWidths(), rowCount: options.rows().length }),
  )
  const rowNumberWidth = createMemo(() => String(options.rows().length).length)
  const rowNumberCellWidth = createMemo(() => rowNumberWidth() + 2)
  const selectedRange = createMemo<CellSelection | null>(() => {
    const current = selection()
    return current?.end ? { start: current.start, end: current.end } : null
  })
  const hasSelectedRange = () => selectedRange() !== null
  const showCursor = () => options.isFocused() && !hasSelectedRange()
  const cursorCell = (): CellRef => ({ kind: "body", row: tableRow(cursorRow()), col: tableCol(cursorCol()) })
  const visibleRows = createMemo(() => {
    return visibleRowsForScrollWindow(options.rows().length, scrollTop(), height(), overscan)
  })

  const syncScrollboxState = () => {
    if (!scrollbox) return

    const viewport = getViewportRect(scrollbox)
    const left = tableX(scrollbox.scrollLeft ?? 0)
    const top = visualRow(scrollbox.scrollTop ?? 0)
    batch(() => {
      if (untrack(scrollLeft) !== left) setScrollLeft(left)
      if (untrack(scrollTop) !== top) setScrollTop(top)
      if (untrack(width) !== viewport.width) setWidth(viewport.width)
      if (untrack(height) !== viewport.height) setHeight(visualRowHeight(Math.max(1, viewport.height)))
    })
  }

  const attachScrollbox = (node: ScrollBoxRenderable | undefined) => {
    scrollbox = node
    if (!scrollbox) return
    syncScrollboxState()
  }

  const resetScroll = () => {
    setScrollLeft(tableX(0))
    setScrollTop(visualRow(0))
    scrollbox?.scrollTo({ x: 0, y: 0 })
  }

  const cellAtScreenPoint = (point: { x: number; y: number }): CellRef | null => {
    const layout = geometry()
    if (!scrollbox) return null

    const viewport = getViewportRect(scrollbox)
    const x = tableX(point.x - viewport.x + scrollLeft())
    if (point.y < viewport.y) {
      return layout.headerCellAt(x)
    }

    return layout.bodyCellAt(x, visualRow(point.y - viewport.y + scrollTop()))
  }

  const scrollCellIntoView = (cell: CellRef) => {
    const layout = geometry()
    if (!scrollbox) return

    const currentTop = scrollbox.scrollTop ?? 0
    const currentLeft = scrollbox.scrollLeft ?? 0
    const viewportHeight = Math.max(1, getViewportRect(scrollbox).height)
    const viewportWidth = Math.max(1, getViewportRect(scrollbox).width)
    let nextTop = currentTop
    let nextLeft = currentLeft

    if (cell.kind === "body") {
      const row = layout.rowVisualRange(cell.row)
      if (row.top < currentTop) {
        nextTop = row.top
      }
      if (row.top + row.height > currentTop + viewportHeight) {
        nextTop = row.top + row.height - viewportHeight
      }
    }

    const col = layout.columnRanges[cell.col]
    if (col) {
      if (col.end > currentLeft + viewportWidth) {
        nextLeft = col.end - viewportWidth
      }
      if (col.start < currentLeft) {
        nextLeft = col.start
      }
    }

    if (nextTop !== currentTop || nextLeft !== currentLeft) {
      scrollbox.scrollTo({ x: nextLeft, y: nextTop })
      syncScrollboxState()
    }
  }

  const nudgeHorizontal = (direction: "left" | "right") => {
    const delta = direction === "left" ? -HORIZONTAL_SCROLL_STEP : HORIZONTAL_SCROLL_STEP
    scrollbox?.scrollBy({ x: delta, y: 0 })
    syncScrollboxState()
  }

  const sameCell = (left: CellRef | null, right: CellRef | null) => {
    if (!left || !right) return left === right
    if (left.kind !== right.kind || left.col !== right.col) return false
    if (left.kind === "header") return true
    return right.kind === "body" && left.row === right.row
  }

  const beginSelection = (cell: CellRef) => {
    setSelection({ start: cell, end: null })
  }

  const extendSelection = (cell: CellRef | null) => {
    setSelection((current) => {
      if (!current) return current
      if (sameCell(current.end, cell)) return current
      return { ...current, end: cell }
    })
  }

  const clearSelection = () => {
    setSelection(null)
  }

  const processNativeSelection = (native: OpenTuiSelection | null) => {
    if (!native?.isActive) return
    if (native.isStart) {
      extendSelection(null)
      return
    }
    extendSelection(cellAtScreenPoint(native.focus))
  }

  const reset = () => {
    setCursorRow(0)
    setCursorCol(0)
    clearSelection()
    resetScroll()
  }

  const moveCursor = (rowDelta: number, colDelta: number, event?: KeyEvent) => {
    const rowCount = options.rows().length
    const colCount = options.columns().length
    if (rowCount === 0 || colCount === 0) return

    event?.preventDefault()
    if (!options.isFocused()) {
      options.focusSelf()
    }

    const previous = cursorCell()
    const nextRow = Math.min(rowCount - 1, Math.max(0, cursorRow() + rowDelta))
    const nextCol = Math.min(colCount - 1, Math.max(0, cursorCol() + colDelta))
    const next = { kind: "body", row: tableRow(nextRow), col: tableCol(nextCol) } satisfies CellRef
    setCursorRow(nextRow)
    setCursorCol(nextCol)
    if (event?.shift) {
      setSelection((current) => ({ start: current?.start ?? previous, end: next }))
    } else {
      clearSelection()
    }
    scrollCellIntoView(next)
  }

  const handleHorizontalScrollShortcut = (direction: "left" | "right") => {
    if (options.columns().length === 0) return
    nudgeHorizontal(direction)
  }

  const handleViewportChange = () => {
    syncScrollboxState()
    if (selection()) {
      processNativeSelection(scrollbox?.ctx.getSelection() ?? null)
    }
  }

  const handleCellMouseDown = (cell: CellRef, event: MouseEvent) => {
    options.focusSelf()
    event.preventDefault()
    beginSelection(cell)
    if (cell.kind === "body") {
      setCursorRow(cell.row)
      setCursorCol(cell.col)
    }
  }

  const keyBindings = (): KeyBinding[] => [
    { pattern: "up", handler: (event) => moveCursor(-1, 0, event), preventDefault: true },
    { pattern: "k", handler: (event) => moveCursor(-1, 0, event), preventDefault: true },
    { pattern: "shift+up", handler: (event) => moveCursor(-1, 0, event), preventDefault: true },
    { pattern: "down", handler: (event) => moveCursor(1, 0, event), preventDefault: true },
    { pattern: "j", handler: (event) => moveCursor(1, 0, event), preventDefault: true },
    { pattern: "shift+down", handler: (event) => moveCursor(1, 0, event), preventDefault: true },
    { pattern: "left", handler: (event) => moveCursor(0, -1, event), preventDefault: true },
    { pattern: "h", handler: (event) => moveCursor(0, -1, event), preventDefault: true },
    { pattern: "shift+left", handler: (event) => moveCursor(0, -1, event), preventDefault: true },
    { pattern: ["ctrl+h", "backspace"], handler: () => handleHorizontalScrollShortcut("left"), preventDefault: true },
    { pattern: "right", handler: (event) => moveCursor(0, 1, event), preventDefault: true },
    { pattern: "l", handler: (event) => moveCursor(0, 1, event), preventDefault: true },
    { pattern: "shift+right", handler: (event) => moveCursor(0, 1, event), preventDefault: true },
    { pattern: "ctrl+l", handler: () => handleHorizontalScrollShortcut("right"), preventDefault: true },
    { pattern: "escape", handler: clearSelection, preventDefault: true },
  ]

  const contentWidth = createMemo(() => Math.max(width(), geometry().totalWidth))
  const contentHeight = createMemo(() => Math.max(height(), geometry().totalVisualRows))

  const isCursorCell = (cell: CellRef) => {
    return showCursor() && cell.kind === "body" && cell.row === cursorRow() && cell.col === cursorCol()
  }

  const isCursorSeparator = (row: TableRow, ref: SeparatorRef) => {
    if (!showCursor() || row !== cursorRow()) return false
    if (ref.afterCol === null) return cursorCol() === 0
    return cursorCol() === ref.afterCol || cursorCol() === ref.afterCol + 1
  }

  const selectionText = () => buildSelectionText(selectedRange(), options.columns(), options.rows())
  setSelectionOverride(selectionText)
  onCleanup(() => {
    setSelectionOverride()
  })

  createEffect(() => {
    options.columns()
    options.rows()
    reset()
  })

  return {
    keyBindings,
    rowNumberCellWidth,
    cursorRow,
    scrollLeft,
    scrollTop,
    contentWidth,
    contentHeight,
    visibleRows,
    attachScrollbox,
    handleViewportChange,
    handleCellMouseDown,
    handleNativeSelectionUpdate: processNativeSelection,
    headerSegments: () => geometry().headerSegments(),
    rowSegments: (row: TableRow) => geometry().rowSegments(row),
    rowVisualRange: (row: TableRow) => geometry().rowVisualRange(row),
    headerText: (col: TableCol) => formatTableCell(options.columns()[col]?.name ?? ""),
    cellText: (row: TableRow, col: TableCol) => formatTableCell(options.rows()[row]?.[col]),
    cellValue: (row: TableRow, col: TableCol) => options.rows()[row]?.[col],
    isCellSelected: (cell: CellRef) => isCellSelected(selectedRange(), cell),
    isSeparatorSelected: (row: TableRow | "header", ref: SeparatorRef) =>
      isSeparatorSelected(selectedRange(), row, ref),
    isCursorCell,
    isCursorSeparator,
  }
}

function buildColumnWidths(columns: OriTableColumn[], rows: unknown[][]) {
  const widths = columns.map((column) => column.name.length)
  for (const row of rows) {
    for (let index = 0; index < columns.length; index += 1) {
      widths[index] = Math.max(widths[index] ?? 0, formatTableCell(row[index]).length)
    }
  }
  return widths
}

function formatTableCell(value: unknown): string {
  return value === null || value === undefined ? "NULL" : String(value)
}

function buildSelectionText(
  selection: CellSelection | null,
  columns: OriTableColumn[],
  rows: unknown[][],
): string | undefined {
  if (!selection) return

  const range = cellSelectionRange(selection)
  const lines: string[] = []
  if (range.includeHeader) {
    const values: string[] = []
    for (let col = Number(range.firstCol); col <= range.lastCol; col += 1) {
      values.push(formatTableCell(columns[col]?.name ?? ""))
    }
    lines.push(values.join("\t"))
  }

  if (range.firstBodyRow !== null && range.lastBodyRow !== null) {
    for (let rowIndex = Number(range.firstBodyRow); rowIndex <= range.lastBodyRow; rowIndex += 1) {
      const row = rows[rowIndex] ?? []
      const values: string[] = []
      for (let col = Number(range.firstCol); col <= range.lastCol; col += 1) {
        values.push(formatTableCell(row[col]))
      }
      lines.push(values.join("\t"))
    }
  }

  return lines.length > 0 ? lines.join("\n") : undefined
}

function visibleRowsForScrollWindow(
  rowCount: number,
  top: VisualRow,
  height: VisualRowHeight,
  overscan: number,
): VisibleTableRow[] {
  if (rowCount === 0) return []

  const first = Math.max(0, Math.floor(top) - overscan)
  const last = Math.min(rowCount, Math.ceil(top + height) + overscan)
  return Array.from({ length: Math.max(0, last - first) }, (_, index) => {
    const row = tableRow(first + index)
    return { row, top: visualRow(row), height: visualRowHeight(1) }
  })
}
