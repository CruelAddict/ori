import { describe, expect, test } from "bun:test"
import type { SyntaxHighlightSpan } from "@utils/syntax-highlighter"
import { renderStatementHighlightRange } from "./buffer-highlight-renderer"
import type { StatementEntry } from "./buffer-statement-cache"
import { displayColumn, docCharOffset, docCharRange, type LineIndex, lineIndex } from "./coords"
import { Document } from "./document"
import type { BufferHighlight, RenderTarget } from "./render-target"
import { createTextGeometry } from "./text-geometry"

type CapturedHighlight = {
  line: LineIndex
  highlight: BufferHighlight
}

function createTestGeometry(document: Document, tabWidth = 2) {
  return createTextGeometry({ getDocument: () => document, tabWidth, getWidthMethod: () => undefined })
}

function createStatement(text: string, spans: SyntaxHighlightSpan[]): StatementEntry {
  return {
    id: "statement-1",
    start: docCharOffset(0),
    end: docCharOffset(text.length),
    startLine: lineIndex(0),
    endLine: lineIndex(text.split("\n").length - 1),
    spans,
    dirty: false,
    highlightVersion: 1,
  }
}

function createCaptureTarget(output: CapturedHighlight[]): RenderTarget {
  return {
    addHighlight: (line, highlight) => {
      output.push({ line, highlight })
    },
    removeHighlightsByRef: () => {},
    requestRender: () => {},
  }
}

describe("buffer highlight renderer", () => {
  test("clips a multiline span to the requested document range", () => {
    const text = "abc\ndef"
    const document = Document.create(text)
    const highlights: CapturedHighlight[] = []
    renderStatementHighlightRange({
      target: createCaptureTarget(highlights),
      statement: createStatement(text, [{ start: 1, end: 6, styleId: 3 }]),
      geometry: createTestGeometry(document),
      highlightGroupId: 7,
      renderRange: docCharRange(2, 5),
    })

    expect(highlights).toEqual([
      {
        line: lineIndex(0),
        highlight: {
          start: displayColumn(2),
          end: displayColumn(3),
          styleId: 3,
          groupId: 7,
        },
      },
      {
        line: lineIndex(1),
        highlight: {
          start: displayColumn(0),
          end: displayColumn(1),
          styleId: 3,
          groupId: 7,
        },
      },
    ])
  })

  test("maps tab-indented spans into display columns", () => {
    const text = "\tdrop\n"
    const document = Document.create(text)
    const highlights: CapturedHighlight[] = []
    renderStatementHighlightRange({
      target: createCaptureTarget(highlights),
      statement: createStatement(text, [{ start: 1, end: 5, styleId: 4 }]),
      geometry: createTestGeometry(document, 2),
      highlightGroupId: 8,
      renderRange: docCharRange(0, text.length),
    })

    expect(highlights).toEqual([
      {
        line: lineIndex(0),
        highlight: {
          start: displayColumn(2),
          end: displayColumn(6),
          styleId: 4,
          groupId: 8,
        },
      },
    ])
  })
})
