import { describe, expect, test } from "bun:test"
import { createOriTableGeometry, tableCol, tableRow, tableX } from "./ori-table-geometry"

describe("ori table geometry", () => {
  test("keeps table geometry in full content coordinates", () => {
    const geometry = createOriTableGeometry({
      columnWidths: [2, 4, 10],
      rowCount: 1,
    })

    expect(
      geometry.columnRanges.map((range) => ({
        start: Number(range.start),
        end: Number(range.end),
        width: Number(range.width),
      })),
    ).toEqual([
      { start: 1, end: 5, width: 4 },
      { start: 6, end: 12, width: 6 },
      { start: 13, end: 25, width: 12 },
    ])
    expect(Number(geometry.totalWidth)).toBe(26)
    expect(geometry.headerCellAt(tableX(0))).toEqual({ kind: "header", col: tableCol(0) })
    expect(geometry.headerCellAt(tableX(6))).toEqual({ kind: "header", col: tableCol(1) })
    expect(geometry.headerCellAt(tableX(100))).toEqual({ kind: "header", col: tableCol(2) })
  })

  test("renders geometry as ordered separators and cells", () => {
    const geometry = createOriTableGeometry({
      columnWidths: [2, 4],
      rowCount: 1,
    })

    expect(geometry.rowSegments(tableRow(0)).map((segment) => segment.kind)).toEqual([
      "separator",
      "cell",
      "separator",
      "cell",
      "separator",
    ])
  })
})
