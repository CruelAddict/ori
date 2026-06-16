import type { QueryColumn } from "@adapters/ori/client"

declare const coordBrand: unique symbol

type Coord<Name extends string> = number & { readonly [coordBrand]: Name }

/** Zero-based row index in result.rows. */
export type DataRow = Coord<"DataRow">

/** Zero-based column index in result.columns. */
export type GridCol = Coord<"GridCol">

/** X coordinate in full table content space. */
export type TableX = Coord<"TableX">

/** Width in full table content space. */
export type TableWidth = Coord<"TableWidth">

/** Y coordinate in visual-row space. A data row may occupy multiple visual rows later. */
export type VisualRow = Coord<"VisualRow">

/** Height in visual-row space. */
export type VisualRowHeight = Coord<"VisualRowHeight">

export type CellRef =
  | {
      kind: "header"
      col: GridCol
    }
  | {
      kind: "body"
      row: DataRow
      col: GridCol
    }

export type CellSelection = {
  start: CellRef
  end: CellRef
}

export type CellSelectionBounds = {
  includeHeader: boolean
  firstBodyRow: DataRow | null
  lastBodyRow: DataRow | null
  firstCol: GridCol
  lastCol: GridCol
}

export type ColumnRange = {
  col: GridCol
  start: TableX
  end: TableX
  width: TableWidth
}

export type VisibleResultRow = {
  row: DataRow
  top: VisualRow
  height: VisualRowHeight
}

export function dataRow(value: number): DataRow {
  return value as DataRow
}

export function gridCol(value: number): GridCol {
  return value as GridCol
}

export function tableX(value: number): TableX {
  return value as TableX
}

export function tableWidth(value: number): TableWidth {
  return value as TableWidth
}

export function visualRow(value: number): VisualRow {
  return value as VisualRow
}

export function visualRowHeight(value: number): VisualRowHeight {
  return value as VisualRowHeight
}

export function formatResultCell(value: unknown): string {
  return value === null || value === undefined ? "NULL" : String(value)
}

export type ResultsGrid = ReturnType<typeof createResultsGrid>

export function createResultsGrid(options: { columns: QueryColumn[]; rows: unknown[][] }) {
  const columns = options.columns
  const rows = options.rows
  const columnWidths = buildColumnWidths(columns, rows)
  const columnRanges = buildColumnRanges(columnWidths)
  const totalWidth = buildTotalWidth(columnWidths)
  const totalVisualRows = visualRowHeight(rows.length)

  const cellAtX = (x: TableX): GridCol | null => getColumnAtX(columnRanges, x)
  const bodyCellAt = (x: TableX, y: VisualRow): CellRef | null => {
    const col = cellAtX(x)
    if (col === null || rows.length === 0) {
      return null
    }

    return {
      kind: "body",
      row: dataRow(Math.min(Math.max(Math.floor(y), 0), rows.length - 1)),
      col,
    }
  }
  const headerCellAt = (x: TableX): CellRef | null => {
    const col = cellAtX(x)
    return col === null ? null : { kind: "header", col }
  }
  const rowVisualRange = (row: DataRow) => ({ top: visualRow(row), height: visualRowHeight(1) })
  const visibleRows = (top: VisualRow, height: VisualRowHeight, overscan: number): VisibleResultRow[] => {
    if (rows.length === 0) return []

    const first = Math.max(0, Math.floor(top) - overscan)
    const last = Math.min(rows.length, Math.ceil(top + height) + overscan)
    return Array.from({ length: Math.max(0, last - first) }, (_, index) => {
      const row = dataRow(first + index)
      return { row, ...rowVisualRange(row) }
    })
  }

  return {
    columns,
    rows,
    columnWidths,
    columnRanges,
    totalWidth,
    totalVisualRows,
    rowCount: () => rows.length,
    columnCount: () => columns.length,
    cellAtX,
    bodyCellAt,
    headerCellAt,
    rowVisualRange,
    visibleRows,
    cellDisplay: (row: DataRow, col: GridCol) => formatResultCell(rows[row]?.[col]),
    headerDisplay: (col: GridCol) => formatResultCell(columns[col]?.name ?? ""),
    cellSelectionBounds,
    cellSelectionText: (selection: CellSelection | null) => buildCellSelectionText(selection, columns, rows),
    isCellSelected,
    isSeparatorSelected,
    isTrailingSeparatorSelected,
  }
}

function buildColumnWidths(columns: QueryColumn[], rows: unknown[][]) {
  const widths = columns.map((column) => column.name.length)
  for (const row of rows) {
    for (let index = 0; index < row.length; index += 1) {
      widths[index] = Math.max(widths[index] ?? 0, formatResultCell(row[index]).length)
    }
  }
  return widths
}

function buildColumnRanges(widths: number[]): ColumnRange[] {
  let start = 1
  return widths.map((width, index) => {
    const cellWidth = width + 2
    const range = {
      col: gridCol(index),
      start: tableX(start),
      end: tableX(start + cellWidth),
      width: tableWidth(cellWidth),
    }
    start += cellWidth + 1
    return range
  })
}

function buildTotalWidth(widths: number[]): TableWidth {
  if (widths.length === 0) return tableWidth(0)
  return tableWidth(widths.reduce((sum, width) => sum + width + 2, 0) + widths.length + 1)
}

function getColumnAtX(ranges: ColumnRange[], x: TableX): GridCol | null {
  if (ranges.length === 0) return null
  if (x <= ranges[0].end) return ranges[0].col

  for (const range of ranges) {
    if (x <= range.end) return range.col
  }

  return ranges[ranges.length - 1]?.col ?? null
}

function cellOrder(cell: CellRef): number {
  return cell.kind === "header" ? -1 : cell.row
}

export function cellSelectionBounds(selection: CellSelection): CellSelectionBounds {
  const firstOrder = Math.min(cellOrder(selection.start), cellOrder(selection.end))
  const lastOrder = Math.max(cellOrder(selection.start), cellOrder(selection.end))
  const firstCol = gridCol(Math.min(selection.start.col, selection.end.col))
  const lastCol = gridCol(Math.max(selection.start.col, selection.end.col))
  const firstBody = Math.max(0, firstOrder)
  const lastBody = lastOrder
  return {
    includeHeader: firstOrder === -1,
    firstBodyRow: lastBody >= firstBody ? dataRow(firstBody) : null,
    lastBodyRow: lastBody >= firstBody ? dataRow(lastBody) : null,
    firstCol,
    lastCol,
  }
}

export function isCellSelected(selection: CellSelection | null, cell: CellRef): boolean {
  if (!selection) return false

  const bounds = cellSelectionBounds(selection)
  if (cell.col < bounds.firstCol || cell.col > bounds.lastCol) return false
  if (cell.kind === "header") return bounds.includeHeader
  if (bounds.firstBodyRow === null || bounds.lastBodyRow === null) return false
  return cell.row >= bounds.firstBodyRow && cell.row <= bounds.lastBodyRow
}

export function isSeparatorSelected(selection: CellSelection | null, row: DataRow | "header", leftCol: GridCol | null) {
  if (!selection) return false

  const bounds = cellSelectionBounds(selection)
  if (!isRowInSelectionBounds(bounds, row)) return false
  if (leftCol === null) return bounds.firstCol === 0
  return leftCol >= bounds.firstCol && leftCol < bounds.lastCol
}

export function isTrailingSeparatorSelected(selection: CellSelection | null, row: DataRow | "header", col: GridCol) {
  if (!selection) return false

  const bounds = cellSelectionBounds(selection)
  return isRowInSelectionBounds(bounds, row) && col === bounds.lastCol
}

function isRowInSelectionBounds(bounds: CellSelectionBounds, row: DataRow | "header") {
  if (row === "header") return bounds.includeHeader
  if (bounds.firstBodyRow === null || bounds.lastBodyRow === null) return false
  return row >= bounds.firstBodyRow && row <= bounds.lastBodyRow
}

function buildCellSelectionText(
  selection: CellSelection | null,
  columns: QueryColumn[],
  rows: unknown[][],
): string | undefined {
  if (!selection) return

  const bounds = cellSelectionBounds(selection)
  const lines: string[] = []
  if (bounds.includeHeader) {
    const values: string[] = []
    for (let col = Number(bounds.firstCol); col <= bounds.lastCol; col += 1) {
      values.push(formatResultCell(columns[col]?.name ?? ""))
    }
    lines.push(values.join("\t"))
  }

  if (bounds.firstBodyRow !== null && bounds.lastBodyRow !== null) {
    for (let rowIndex = Number(bounds.firstBodyRow); rowIndex <= bounds.lastBodyRow; rowIndex += 1) {
      const row = rows[rowIndex] ?? []
      const values: string[] = []
      for (let col = Number(bounds.firstCol); col <= bounds.lastCol; col += 1) {
        values.push(formatResultCell(row[col]))
      }
      lines.push(values.join("\t"))
    }
  }

  return lines.length > 0 ? lines.join("\n") : undefined
}
