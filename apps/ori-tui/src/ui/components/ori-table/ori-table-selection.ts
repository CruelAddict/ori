import { type CellRef, type SeparatorRef, type TableCol, type TableRow, tableCol, tableRow } from "./ori-table-geometry"

export type CellSelection = {
  start: CellRef
  end: CellRef
}

export type CellSelectionRange = {
  includeHeader: boolean
  firstBodyRow: TableRow | null
  lastBodyRow: TableRow | null
  firstCol: TableCol
  lastCol: TableCol
}

export function cellSelectionRange(selection: CellSelection): CellSelectionRange {
  const includeHeader = selection.start.kind === "header"
  const firstCol = tableCol(Math.min(selection.start.col, selection.end.col))
  const lastCol = tableCol(Math.max(selection.start.col, selection.end.col))
  const bodyRows = [selection.start, selection.end]
    .filter((cell): cell is Extract<CellRef, { kind: "body" }> => cell.kind === "body")
    .map((cell) => cell.row)
  const firstBodyRow = bodyRows.length > 0 ? tableRow(includeHeader ? 0 : Math.min(...bodyRows)) : null
  const lastBodyRow = bodyRows.length > 0 ? tableRow(Math.max(...bodyRows)) : null
  return {
    includeHeader,
    firstBodyRow,
    lastBodyRow,
    firstCol,
    lastCol,
  }
}

export function isCellSelected(selection: CellSelection | null, cell: CellRef): boolean {
  if (!selection) return false

  const range = cellSelectionRange(selection)
  if (cell.col < range.firstCol || cell.col > range.lastCol) return false
  if (cell.kind === "header") return range.includeHeader
  if (range.firstBodyRow === null || range.lastBodyRow === null) return false
  return cell.row >= range.firstBodyRow && cell.row <= range.lastBodyRow
}

export function isSeparatorSelected(
  selection: CellSelection | null,
  row: TableRow | "header",
  separator: SeparatorRef,
) {
  if (!selection) return false

  const range = cellSelectionRange(selection)
  if (!isRowInSelectionRange(range, row)) return false
  if (separator.afterCol === null) return range.firstCol === 0
  return separator.afterCol >= range.firstCol && separator.afterCol <= range.lastCol
}

function isRowInSelectionRange(range: CellSelectionRange, row: TableRow | "header") {
  if (row === "header") return range.includeHeader
  if (range.firstBodyRow === null || range.lastBodyRow === null) return false
  return row >= range.firstBodyRow && row <= range.lastBodyRow
}
