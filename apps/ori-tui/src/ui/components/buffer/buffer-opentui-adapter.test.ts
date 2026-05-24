import { describe, expect, test } from "bun:test"
import type { LineInfo } from "@opentui/core"
import {
  resolveCursorDocOffset,
  resolveViewportOffsetPoint,
  resolveVisualCursorDocOffset,
} from "./buffer-opentui-adapter"
import { containerX, containerY, docCharOffset } from "./coords"
import { Document } from "./document"

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

  test("maps a later line viewport point without subtracting previous line width", () => {
    const text = "select * from authors\nselect * fr"

    expect(
      resolveViewportOffsetPoint({
        document: Document.create(text),
        offset: docCharOffset(text.lastIndexOf("fr")),
        lineInfo: {
          lineStartCols: [0, 22],
          lineWidthCols: [21, 11],
          lineWidthColsMax: 21,
          lineSources: [0, 1],
          lineWraps: [0, 0],
        } satisfies LineInfo,
        widthMethod: undefined,
        tabWidth: 2,
        scrollY: 0,
        viewportHeight: 20,
      }),
    ).toEqual({ x: containerX(9), y: containerY(1) })
  })

  test("maps wrapped rows relative to their source line", () => {
    expect(
      resolveViewportOffsetPoint({
        document: Document.create("ignored\nabcdefghijkl"),
        offset: docCharOffset("ignored\nabcdefghijkl".length),
        lineInfo: {
          lineStartCols: [22, 32],
          lineWidthCols: [10, 2],
          lineWidthColsMax: 10,
          lineSources: [1, 1],
          lineWraps: [0, 1],
        } satisfies LineInfo,
        widthMethod: undefined,
        tabWidth: 2,
        scrollY: 0,
        viewportHeight: 20,
      }),
    ).toEqual({ x: containerX(2), y: containerY(1) })
  })

  test("maps a wrapped visual row back into a document offset", () => {
    const text = "ignored\nabcdefghijklmnopqrstuvwxyz0123456789"

    expect(
      resolveVisualCursorDocOffset({
        document: Document.create(text),
        visualRow: 1,
        visualCol: 2,
        lineInfo: {
          lineStartCols: [22, 32],
          lineWidthCols: [10, 10],
          lineWidthColsMax: 10,
          lineSources: [1, 1],
          lineWraps: [0, 1],
        } satisfies LineInfo,
        widthMethod: undefined,
        tabWidth: 2,
      }),
    ).toBe(docCharOffset("ignored\nabcdefghijkl".length))
  })

  test("clamps a wrapped visual column to the end of its visual row", () => {
    const text = "ignored\nabcdefghijklmnopqrstuvwxyz0123456789"

    expect(
      resolveVisualCursorDocOffset({
        document: Document.create(text),
        visualRow: 1,
        visualCol: 12,
        lineInfo: {
          lineStartCols: [22, 32],
          lineWidthCols: [10, 10],
          lineWidthColsMax: 10,
          lineSources: [1, 1],
          lineWraps: [0, 1],
        } satisfies LineInfo,
        widthMethod: undefined,
        tabWidth: 2,
      }),
    ).toBe(docCharOffset("ignored\nabcdefghijklmnopqrst".length))
  })
})
