import { describe, expect, test } from "bun:test"
import {
  cellSelectionBounds,
  createResultsGrid,
  dataRow,
  gridCol,
  tableX,
  visualRow,
  visualRowHeight,
} from "./results-grid"

const columns = [
  { name: "id", type: "int" },
  { name: "name", type: "text" },
  { name: "note", type: "text" },
]

describe("results grid", () => {
  test("keeps table geometry in full content coordinates", () => {
    const grid = createResultsGrid({
      columns,
      rows: [[1, "ann", "long-value"]],
    })

    expect(
      grid.columnRanges.map((range) => ({
        start: Number(range.start),
        end: Number(range.end),
        width: Number(range.width),
      })),
    ).toEqual([
      { start: 1, end: 5, width: 4 },
      { start: 6, end: 12, width: 6 },
      { start: 13, end: 25, width: 12 },
    ])
    expect(Number(grid.totalWidth)).toBe(26)
    expect(grid.headerCellAt(tableX(0))).toEqual({ kind: "header", col: gridCol(0) })
    expect(grid.headerCellAt(tableX(6))).toEqual({ kind: "header", col: gridCol(1) })
    expect(grid.headerCellAt(tableX(100))).toEqual({ kind: "header", col: gridCol(2) })
  })

  test("returns rows intersecting visual viewport with overscan", () => {
    const grid = createResultsGrid({
      columns: [{ name: "id", type: "int" }],
      rows: Array.from({ length: 20 }, (_, index) => [index]),
    })

    expect(
      grid
        .visibleRows(visualRow(10), visualRowHeight(4), 2)
        .map((row) => ({ row: Number(row.row), top: Number(row.top), height: Number(row.height) })),
    ).toEqual([
      { row: 8, top: 8, height: 1 },
      { row: 9, top: 9, height: 1 },
      { row: 10, top: 10, height: 1 },
      { row: 11, top: 11, height: 1 },
      { row: 12, top: 12, height: 1 },
      { row: 13, top: 13, height: 1 },
      { row: 14, top: 14, height: 1 },
      { row: 15, top: 15, height: 1 },
    ])
  })

  test("derives selection bounds without duplicating normalized state", () => {
    const bounds = cellSelectionBounds({
      start: { kind: "body", row: dataRow(4), col: gridCol(2) },
      end: { kind: "header", col: gridCol(1) },
    })

    expect(bounds).toEqual({
      includeHeader: true,
      firstBodyRow: dataRow(0),
      lastBodyRow: dataRow(4),
      firstCol: gridCol(1),
      lastCol: gridCol(2),
    })
  })

  test("builds TSV through the same cell formatter as display", () => {
    const grid = createResultsGrid({
      columns,
      rows: [
        [1, "ann", null],
        [2, undefined, "ok"],
      ],
    })
    const text = grid.cellSelectionText({
      start: { kind: "header", col: gridCol(1) },
      end: { kind: "body", row: dataRow(1), col: gridCol(2) },
    })

    expect(text).toBe("name\tnote\nann\tNULL\nNULL\tok")
  })
})
