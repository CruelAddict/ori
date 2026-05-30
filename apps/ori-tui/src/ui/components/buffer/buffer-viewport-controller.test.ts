import { describe, expect, test } from "bun:test"
import type { LineInfo } from "@opentui/core"
import { resolveViewportOffsetPoint, resolveVisualCursorDocOffset } from "./buffer-viewport-controller"
import { containerX, containerY, docCharOffset } from "./coords"
import { Document } from "./document"
import { createTextGeometry } from "./text-geometry"

function createTestGeometry(document: Document) {
  return createTextGeometry({ getDocument: () => document, tabWidth: 2, getWidthMethod: () => undefined })
}

describe("buffer viewport controller", () => {
  test("maps a single-line cursor directly into a document offset", () => {
    expect(Document.create("select * from auth").offsetAtLineChar(0, 18)).toBe(docCharOffset(18))
  })

  test("maps a later line using document line starts", () => {
    expect(Document.create("select 1\nselect * from auth\n").offsetAtLineChar(1, 18)).toBe(docCharOffset(27))
  })

  test("does not let earlier tabs skew later line offsets", () => {
    const text = "\tfoo\n\tbar\nselect * from auth\n"
    const lineStart = text.lastIndexOf("select * from auth")

    expect(Document.create(text).offsetAtLineChar(2, 18)).toBe(docCharOffset(lineStart + 18))
  })

  test("does not let earlier wide characters skew later line offsets", () => {
    const text = "表\n🙂\nselect * from auth\n"
    const lineStart = text.lastIndexOf("select * from auth")

    expect(Document.create(text).offsetAtLineChar(2, 18)).toBe(docCharOffset(lineStart + 18))
  })

  test("treats the current line column as a character offset even with tabs", () => {
    const document = Document.create("\tselect * from auth\n")

    expect(document.offsetAtLineChar(0, 1)).toBe(docCharOffset(1))
    expect(document.offsetAtLineChar(0, 19)).toBe(docCharOffset(19))
  })

  test("treats the current line column as a character offset even with wide characters", () => {
    const document = Document.create("表auth\n")

    expect(document.offsetAtLineChar(0, 1)).toBe(docCharOffset(1))
    expect(document.offsetAtLineChar(0, 5)).toBe(docCharOffset(5))
  })

  test("clamps past-the-end columns to the line end before newline", () => {
    expect(Document.create("auth\nUSE\n").offsetAtLineChar(0, 99)).toBe(docCharOffset(4))
  })

  test("clamps out-of-range rows to the last line", () => {
    expect(Document.create("auth\n").offsetAtLineChar(99, 2)).toBe(docCharOffset(5))
  })

  test("maps a later line viewport point without subtracting previous line width", () => {
    const text = "select * from authors\nselect * fr"

    expect(
      resolveViewportOffsetPoint({
        geometry: createTestGeometry(Document.create(text)),
        offset: docCharOffset(text.lastIndexOf("fr")),
        lineInfo: {
          lineStartCols: [0, 22],
          lineWidthCols: [21, 11],
          lineWidthColsMax: 21,
          lineSources: [0, 1],
          lineWraps: [0, 0],
        } satisfies LineInfo,
        scrollY: 0,
        viewportHeight: 20,
      }),
    ).toEqual({ x: containerX(9), y: containerY(1) })
  })

  test("maps wrapped rows relative to their source line", () => {
    expect(
      resolveViewportOffsetPoint({
        geometry: createTestGeometry(Document.create("ignored\nabcdefghijkl")),
        offset: docCharOffset("ignored\nabcdefghijkl".length),
        lineInfo: {
          lineStartCols: [22, 32],
          lineWidthCols: [10, 2],
          lineWidthColsMax: 10,
          lineSources: [1, 1],
          lineWraps: [0, 1],
        } satisfies LineInfo,
        scrollY: 0,
        viewportHeight: 20,
      }),
    ).toEqual({ x: containerX(2), y: containerY(1) })
  })

  test("maps a wrapped visual row back into a document offset", () => {
    const text = "ignored\nabcdefghijklmnopqrstuvwxyz0123456789"

    expect(
      resolveVisualCursorDocOffset({
        geometry: createTestGeometry(Document.create(text)),
        visualRow: 1,
        visualCol: 2,
        lineInfo: {
          lineStartCols: [22, 32],
          lineWidthCols: [10, 10],
          lineWidthColsMax: 10,
          lineSources: [1, 1],
          lineWraps: [0, 1],
        } satisfies LineInfo,
      }),
    ).toBe(docCharOffset("ignored\nabcdefghijkl".length))
  })

  test("clamps a wrapped visual column to the end of its visual row", () => {
    const text = "ignored\nabcdefghijklmnopqrstuvwxyz0123456789"

    expect(
      resolveVisualCursorDocOffset({
        geometry: createTestGeometry(Document.create(text)),
        visualRow: 1,
        visualCol: 12,
        lineInfo: {
          lineStartCols: [22, 32],
          lineWidthCols: [10, 10],
          lineWidthColsMax: 10,
          lineSources: [1, 1],
          lineWraps: [0, 1],
        } satisfies LineInfo,
      }),
    ).toBe(docCharOffset("ignored\nabcdefghijklmnopqrst".length))
  })
})
