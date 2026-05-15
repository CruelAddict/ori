import { describe, expect, test } from "bun:test"
import { docCharOffset } from "./coords"
import { resolveCursorDocOffset } from "./buffer-opentui-adapter"

describe("buffer opentui adapter", () => {
  test("maps a single-line cursor directly into a document offset", () => {
    expect(resolveCursorDocOffset("select * from auth", 0, 18)).toBe(docCharOffset(18))
  })

  test("maps a later line using document line starts", () => {
    expect(resolveCursorDocOffset("select 1\nselect * from auth\n", 1, 18)).toBe(docCharOffset(27))
  })

  test("does not let earlier tabs skew later line offsets", () => {
    const text = "\tfoo\n\tbar\nselect * from auth\n"
    const lineStart = text.lastIndexOf("select * from auth")

    expect(resolveCursorDocOffset(text, 2, 18)).toBe(docCharOffset(lineStart + 18))
  })

  test("does not let earlier wide characters skew later line offsets", () => {
    const text = "表\n🙂\nselect * from auth\n"
    const lineStart = text.lastIndexOf("select * from auth")

    expect(resolveCursorDocOffset(text, 2, 18)).toBe(docCharOffset(lineStart + 18))
  })

  test("treats the current line column as a character offset even with tabs", () => {
    expect(resolveCursorDocOffset("\tselect * from auth\n", 0, 1)).toBe(docCharOffset(1))
    expect(resolveCursorDocOffset("\tselect * from auth\n", 0, 19)).toBe(docCharOffset(19))
  })

  test("treats the current line column as a character offset even with wide characters", () => {
    expect(resolveCursorDocOffset("表auth\n", 0, 1)).toBe(docCharOffset(1))
    expect(resolveCursorDocOffset("表auth\n", 0, 5)).toBe(docCharOffset(5))
  })

  test("clamps past-the-end columns to the line end before newline", () => {
    expect(resolveCursorDocOffset("auth\nUSE\n", 0, 99)).toBe(docCharOffset(4))
  })

  test("clamps out-of-range rows to the last line", () => {
    expect(resolveCursorDocOffset("auth\n", 99, 2)).toBe(docCharOffset(5))
  })
})
