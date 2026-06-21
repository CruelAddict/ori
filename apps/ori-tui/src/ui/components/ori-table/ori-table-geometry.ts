declare const coordBrand: unique symbol

type Coord<Name extends string> = number & { readonly [coordBrand]: Name }

/** Zero-based index into the `rows` array. */
export type TableRow = Coord<"TableRow">

/** Zero-based index into the `columns` array. */
export type TableCol = Coord<"TableCol">

/** Terminal column inside the rendered table content. Includes separators and cell padding. */
export type TableX = Coord<"TableX">

/** Width in terminal columns inside the rendered table content. */
export type TableWidth = Coord<"TableWidth">

/** Terminal row inside the scrollable table body. Separate from TableRow for future multiline rows. */
export type VisualRow = Coord<"VisualRow">

/** Height in terminal rows inside the scrollable table body. Currently 1 per data row. */
export type VisualRowHeight = Coord<"VisualRowHeight">

export type CellRef =
  | {
      kind: "header"
      col: TableCol
    }
  | {
      kind: "body"
      row: TableRow
      col: TableCol
    }

export type ColumnRange = {
  col: TableCol
  /** First terminal column occupied by this cell, after the left separator. */
  start: TableX
  /** Terminal column occupied by the separator after this cell. */
  end: TableX
  /** Cell width in terminal columns, including left and right padding. */
  width: TableWidth
}

export type SeparatorRef = {
  afterCol: TableCol | null
}

export type TableSegment =
  | {
      kind: "separator"
      ref: SeparatorRef
      x: TableX
      width: TableWidth
    }
  | {
      kind: "cell"
      cell: CellRef
      x: TableX
      width: TableWidth
    }

export type VisibleTableRow = {
  row: TableRow
  top: VisualRow
  height: VisualRowHeight
}

export function tableRow(value: number): TableRow {
  return value as TableRow
}

export function tableCol(value: number): TableCol {
  return value as TableCol
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

export type OriTableGeometry = ReturnType<typeof createOriTableGeometry>

export function createOriTableGeometry(options: { columnWidths: number[]; rowCount: number }) {
  const columnRanges = buildColumnRanges(options.columnWidths)
  const totalWidth = buildTotalWidth(options.columnWidths)
  const totalVisualRows = visualRowHeight(options.rowCount)
  const headerSegments = buildHeaderSegments(columnRanges)

  const rowVisualRange = (row: TableRow) => ({ top: visualRow(row), height: visualRowHeight(1) })
  const cellAtX = (x: TableX): TableCol | null => getColumnAtX(columnRanges, x)
  const headerCellAt = (x: TableX): CellRef | null => {
    const col = cellAtX(x)
    return col === null ? null : { kind: "header", col }
  }
  const bodyCellAt = (x: TableX, y: VisualRow): CellRef | null => {
    const col = cellAtX(x)
    if (col === null || options.rowCount === 0) {
      return null
    }

    return {
      kind: "body",
      row: tableRow(Math.min(options.rowCount - 1, Math.max(0, Math.floor(y)))),
      col,
    }
  }

  return {
    columnRanges,
    totalWidth,
    totalVisualRows,
    rowVisualRange,
    cellAtX,
    headerCellAt,
    bodyCellAt,
    headerSegments: () => headerSegments,
    rowSegments: (row: TableRow) => buildRowSegments(columnRanges, row),
  }
}

function buildColumnRanges(widths: number[]): ColumnRange[] {
  let start = 1
  return widths.map((width, index) => {
    const cellWidth = width + 2
    const range = {
      col: tableCol(index),
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

function buildHeaderSegments(ranges: ColumnRange[]): TableSegment[] {
  return buildSegments(ranges, (col) => ({ kind: "header", col }))
}

function buildRowSegments(ranges: ColumnRange[], row: TableRow): TableSegment[] {
  return buildSegments(ranges, (col) => ({ kind: "body", row, col }))
}

function buildSegments(ranges: ColumnRange[], cell: (col: TableCol) => CellRef): TableSegment[] {
  const segments: TableSegment[] = []
  segments.push({ kind: "separator", ref: { afterCol: null }, x: tableX(0), width: tableWidth(1) })

  for (const range of ranges) {
    segments.push({ kind: "cell", cell: cell(range.col), x: range.start, width: range.width })
    segments.push({ kind: "separator", ref: { afterCol: range.col }, x: range.end, width: tableWidth(1) })
  }

  return segments
}

function getColumnAtX(ranges: ColumnRange[], x: TableX): TableCol | null {
  if (ranges.length === 0) return null
  if (x <= ranges[0].end) return ranges[0].col

  for (const range of ranges) {
    if (x <= range.end) return range.col
  }

  return ranges[ranges.length - 1]?.col ?? null
}
