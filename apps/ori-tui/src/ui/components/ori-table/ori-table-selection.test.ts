import { describe, expect, test } from "bun:test"
import { tableCol, tableRow } from "./ori-table-geometry"
import { cellSelectionRange } from "./ori-table-selection"

describe("ori table selection", () => {
  test("includes header only when selection starts from header", () => {
    expect(
      cellSelectionRange({
        start: { kind: "header", col: tableCol(0) },
        end: { kind: "body", row: tableRow(2), col: tableCol(1) },
      }),
    ).toMatchObject({
      includeHeader: true,
      firstBodyRow: tableRow(0),
      lastBodyRow: tableRow(2),
      firstCol: tableCol(0),
      lastCol: tableCol(1),
    })

    expect(
      cellSelectionRange({
        start: { kind: "body", row: tableRow(2), col: tableCol(1) },
        end: { kind: "header", col: tableCol(0) },
      }),
    ).toMatchObject({
      includeHeader: false,
      firstBodyRow: tableRow(2),
      lastBodyRow: tableRow(2),
      firstCol: tableCol(0),
      lastCol: tableCol(1),
    })
  })
})
