import { type Accessor, batch, createEffect, createMemo, createSignal, untrack } from "solid-js"
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
  rowNumberOffset: Accessor<number>
  isFocused: Accessor<boolean>
  onSelectionInvalidated?: () => void
  overscan?: number
}

export type OriTableVM = ReturnType<typeof createOriTableVM>

export function createOriTableVM(options: CreateOriTableVMOptions) {
  let viewportX = 0
  let viewportY = 0
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
  const rowNumberWidth = createMemo(() => String(options.rowNumberOffset() + options.rows().length).length)
  const rowNumberCellWidth = createMemo(() => rowNumberWidth() + 2)
  const selectedRange = createMemo<CellSelection | null>(() => {
    const current = selection()
    return current?.end ? { start: current.start, end: current.end } : null
  })
  const hasSelectedRange = () => selectedRange() !== null
  const showCursor = () => options.isFocused() && !hasSelectedRange()
  const visibleRows = createMemo(() => {
    return visibleRowsForScrollWindow(options.rows().length, scrollTop(), height(), overscan)
  })

  const setViewport = (viewport: {
    x: number
    y: number
    width: number
    height: number
    scrollLeft: number
    scrollTop: number
  }) => {
    viewportX = viewport.x
    viewportY = viewport.y
    const left = tableX(viewport.scrollLeft)
    const top = visualRow(viewport.scrollTop)
    const nextHeight = visualRowHeight(Math.max(1, viewport.height))
    batch(() => {
      if (untrack(scrollLeft) !== left) setScrollLeft(left)
      if (untrack(scrollTop) !== top) setScrollTop(top)
      if (untrack(width) !== viewport.width) setWidth(viewport.width)
      if (untrack(height) !== nextHeight) setHeight(nextHeight)
    })
  }

  const cellAtMouseDragPoint = (point: { x: number; y: number }): CellRef | null => {
    const layout = geometry()
    const x = tableX(point.x - viewportX + scrollLeft())
    if (point.y < viewportY) {
      if (selection()?.start.kind === "header") {
        return layout.headerCellAt(x)
      }

      return layout.bodyCellAt(x, scrollTop())
    }

    const y = Math.min(point.y - viewportY, Math.max(0, Number(height()) - 1))
    return layout.bodyCellAt(x, visualRow(y + scrollTop()))
  }

  const sameCell = (left: CellRef | null, right: CellRef | null) => {
    if (!left || !right) return left === right
    if (left.kind !== right.kind || left.col !== right.col) return false
    if (left.kind === "header") return true
    return right.kind === "body" && left.row === right.row
  }

  const beginSelection = (cell: CellRef) => {
    setSelection({ start: cell, end: null })
    if (cell.kind === "body") {
      setCursorRow(cell.row)
      setCursorCol(cell.col)
    }
  }

  const extendSelection = (cell: CellRef | null) => {
    setSelection((current) => {
      if (!current) return current
      if (sameCell(current.end, cell)) return current
      return { ...current, end: cell }
    })
  }

  const clearSelection = () => {
    if (untrack(selection)) {
      options.onSelectionInvalidated?.()
    }
    setSelection(null)
  }

  const restoreSelection = (range: CellSelection) => {
    setSelection({ start: range.start, end: range.end })
  }

  const reset = () => {
    setCursorRow(0)
    setCursorCol(0)
    clearSelection()
    setScrollLeft(tableX(0))
    setScrollTop(visualRow(0))
  }

  const moveCursor = (rowDelta: number, colDelta: number): { x: number; y: number } | undefined => {
    const rowCount = options.rows().length
    const colCount = options.columns().length
    if (rowCount === 0 || colCount === 0) return

    const nextRow = Math.min(rowCount - 1, Math.max(0, cursorRow() + rowDelta))
    const nextCol = Math.min(colCount - 1, Math.max(0, cursorCol() + colDelta))
    const next = { kind: "body", row: tableRow(nextRow), col: tableCol(nextCol) } satisfies CellRef
    setCursorRow(nextRow)
    setCursorCol(nextCol)
    clearSelection()
    const layout = geometry()
    const currentTop = Number(scrollTop())
    const currentLeft = Number(scrollLeft())
    const viewportHeight = Math.max(1, Number(height()))
    const viewportWidth = Math.max(1, width())
    let nextTop = currentTop
    let nextLeft = currentLeft

    const row = layout.rowVisualRange(next.row)
    if (row.top < currentTop) {
      nextTop = row.top
    }
    if (row.top + row.height > currentTop + viewportHeight) {
      nextTop = row.top + row.height - viewportHeight
    }

    const col = layout.columnRanges[next.col]
    if (col) {
      if (col.end > currentLeft + viewportWidth) {
        nextLeft = col.end - viewportWidth
      }
      if (col.start < currentLeft) {
        nextLeft = col.start
      }
    }

    return nextTop !== currentTop || nextLeft !== currentLeft ? { x: nextLeft, y: nextTop } : undefined
  }

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

  createEffect(() => {
    options.columns()
    options.rows()
    reset()
  })

  return {
    rowNumberCellWidth,
    cursorRow,
    scrollLeft,
    scrollTop,
    contentWidth,
    contentHeight,
    visibleRows,
    setViewport,
    moveCursor,
    beginSelection,
    extendSelection,
    clearSelection,
    getSelectionRange: selectedRange,
    restoreSelection,
    readSelected: selectionText,
    hasSelection: () => selection() !== null,
    cellAtMouseDragPoint,
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
