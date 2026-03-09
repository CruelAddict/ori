import { offsetToLineCol } from "@utils/line-offsets"
import type { SyntaxHighlightResult } from "@utils/syntax-highlighter"
import { createEffect, on } from "solid-js"
import { applySyntaxHighlights, forceReapplySyntaxHighlightForLineId } from "../sql-highlighter"
import type { BufferContext } from "./context"
import { toDisplayColumn } from "./lines"
import { getLineRef } from "./navigation"

type HighlightLineSpan = {
  start: number
  end: number
  styleId: number
}

function buildHighlightSpansByLine(buffer: BufferContext, highlight: SyntaxHighlightResult) {
  const spansByLine = new Map<number, HighlightLineSpan[]>()
  const starts = buffer.lineStarts()

  for (const span of highlight.spans) {
    const start = offsetToLineCol(span.start, starts)
    const end = offsetToLineCol(span.end, starts)
    if (start.line !== end.line) {
      continue
    }

    const lineText = buffer.lines()[start.line]?.text ?? ""
    const spans = spansByLine.get(start.line) ?? []
    spans.push({
      start: toDisplayColumn(lineText, start.col),
      end: toDisplayColumn(lineText, end.col),
      styleId: span.styleId,
    })
    spansByLine.set(start.line, spans)
  }

  for (const spans of spansByLine.values()) {
    spans.sort((a, b) => a.start - b.start || a.end - b.end)
  }

  return spansByLine
}

export function requestHighlights(buffer: BufferContext) {
  const nextVersion = ++buffer.state.resources.highlightRequestVersion
  buffer.state.ports.scheduleHighlight(buffer.fullText(), nextVersion)
}

export function mountHighlighting(buffer: BufferContext) {
  createEffect(
    on(buffer.state.ports.highlightResult, (highlight) => {
      if (highlight.version !== buffer.state.resources.highlightRequestVersion) {
        return
      }

      const spansByLine = buildHighlightSpansByLine(buffer, highlight)
      applySyntaxHighlights({
        spansByLine,
        syntaxStyle: highlight.syntaxStyle,
        lineCount: buffer.lines().length,
        getLineRef: (index) => getLineRef(buffer, index),
      })
    }),
  )
}

export function reapplyLineHighlight(buffer: BufferContext, lineId: string) {
  forceReapplySyntaxHighlightForLineId({
    lineId,
    highlight: buffer.state.ports.highlightResult(),
    lineStarts: buffer.lineStarts(),
    getLineRef: (index) => getLineRef(buffer, index),
    getLineIndexById: (lineId) => buffer.lines().findIndex((entry) => entry.id === lineId),
    getLineText: (index) => buffer.lines()[index]?.text ?? "",
    toDisplayColumn,
  })
}
