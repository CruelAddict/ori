import { describe, expect, test } from "bun:test"
import { displayColumn, lineCharOffset, lineCharRange } from "./coords"
import {
  lineCharOffsetToDisplayColumn,
  lineCharRangeToDisplayRange,
  lineDisplayColumnToCharOffset,
} from "./text-metrics"

const source = {
  tabWidth: 4,
  widthMethod: undefined,
}

describe("buffer text metrics", () => {
  test("expands tabs when mapping line character offsets to display columns", () => {
    expect(lineCharOffsetToDisplayColumn(source, "\tselect", lineCharOffset(1))).toBe(displayColumn(4))
    expect(lineCharOffsetToDisplayColumn(source, "\tselect", lineCharOffset(2))).toBe(displayColumn(5))
  })

  test("expands tabs from the current display column", () => {
    expect(lineCharOffsetToDisplayColumn(source, "ab\tc", lineCharOffset(2))).toBe(displayColumn(2))
    expect(lineCharOffsetToDisplayColumn(source, "ab\tc", lineCharOffset(3))).toBe(displayColumn(4))
    expect(lineCharOffsetToDisplayColumn(source, "ab\tc", lineCharOffset(4))).toBe(displayColumn(5))
  })

  test("maps display columns inside tabs to the next character offset", () => {
    expect(lineDisplayColumnToCharOffset(source, "a\tb", displayColumn(0))).toBe(lineCharOffset(0))
    expect(lineDisplayColumnToCharOffset(source, "a\tb", displayColumn(1))).toBe(lineCharOffset(1))
    expect(lineDisplayColumnToCharOffset(source, "a\tb", displayColumn(2))).toBe(lineCharOffset(2))
    expect(lineDisplayColumnToCharOffset(source, "a\tb", displayColumn(4))).toBe(lineCharOffset(2))
    expect(lineDisplayColumnToCharOffset(source, "a\tb", displayColumn(5))).toBe(lineCharOffset(3))
  })

  test("maps replacement ranges after tabs into display-space ranges", () => {
    expect(lineCharRangeToDisplayRange(source, "\tse", lineCharRange(1, 3))).toEqual({
      start: displayColumn(4),
      end: displayColumn(6),
    })
  })

  test("maps replacement ranges containing tabs into display-space ranges", () => {
    expect(lineCharRangeToDisplayRange(source, "a\tbc", lineCharRange(1, 2))).toEqual({
      start: displayColumn(1),
      end: displayColumn(4),
    })
  })

  test("counts Chinese characters as wide display columns", () => {
    expect(lineCharOffsetToDisplayColumn(source, "你a", lineCharOffset(1))).toBe(displayColumn(2))
    expect(lineCharOffsetToDisplayColumn(source, "你a", lineCharOffset(2))).toBe(displayColumn(3))
  })

  test("maps display columns inside Chinese characters to the next character offset", () => {
    expect(lineDisplayColumnToCharOffset(source, "你a", displayColumn(1))).toBe(lineCharOffset(1))
    expect(lineDisplayColumnToCharOffset(source, "你a", displayColumn(2))).toBe(lineCharOffset(1))
  })
})
