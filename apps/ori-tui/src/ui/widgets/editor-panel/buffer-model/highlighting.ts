import type { SyntaxStyle, TextareaRenderable } from "@opentui/core"
import { offsetToLineCol } from "@utils/line-offsets"
import type { SyntaxHighlightResult } from "@utils/syntax-highlighter"
import { createEffect, on } from "solid-js"
import type { BufferContext } from "./context"
import { toDisplayColumn } from "./lines"
import { getLineRef } from "./navigation"

const SYNTAX_EXTMARK_TYPE = "syntax-highlight"

type LineSpan = {
  start: number
  end: number
  styleId: number
}

function spansEqual(a: LineSpan[], b: LineSpan[]) {
  if (a.length !== b.length) {
    return false
  }
  for (let i = 0; i < a.length; i++) {
    const left = a[i]
    const right = b[i]
    if (left.start !== right.start || left.end !== right.end || left.styleId !== right.styleId) {
      return false
    }
  }
  return true
}

// Apply one line's highlight spans to its textarea ref.
function applyLineHighlights(params: {
  ref: TextareaRenderable
  nextSpans: LineSpan[]
  syntaxStyle: SyntaxStyle
  force: boolean
}) {
  const refState = params.ref as TextareaRenderable & { syntaxStyle?: SyntaxStyle; __syntaxSpans?: LineSpan[] }
  const prevSpans = refState.__syntaxSpans ?? []
  const styleChanged = refState.syntaxStyle !== params.syntaxStyle
  const spansChanged = !spansEqual(prevSpans, params.nextSpans)

  if (!params.force && !styleChanged && !spansChanged) {
    return
  }

  if (params.force || spansChanged) {
    const typeId =
      params.ref.extmarks.getTypeId(SYNTAX_EXTMARK_TYPE) ?? params.ref.extmarks.registerType(SYNTAX_EXTMARK_TYPE)
    const marks = params.ref.extmarks.getAllForTypeId(typeId)
    for (const mark of marks) {
      params.ref.extmarks.delete(mark.id)
    }
    for (const span of params.nextSpans) {
      params.ref.extmarks.create({
        start: span.start,
        end: span.end,
        styleId: span.styleId,
        typeId,
        virtual: false,
      })
    }
    refState.__syntaxSpans = params.nextSpans.map((span) => ({ ...span }))
  }

  if (params.force || styleChanged) {
    refState.syntaxStyle = params.syntaxStyle
  }

  params.ref.requestRender()
}

// Convert global highlight offsets into per-line spans.
function buildHighlightSpansByLine(buffer: BufferContext, highlight: SyntaxHighlightResult) {
  const spansByLine = new Map<number, LineSpan[]>()
  const lines = buffer.lines()
  const starts = buffer.lineStarts()

  for (const span of highlight.spans) {
    const start = offsetToLineCol(span.start, starts)
    const end = offsetToLineCol(span.end, starts)
    if (start.line !== end.line) {
      continue
    }

    const lineText = lines[start.line]?.text ?? ""
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

// Rebuild highlight spans for one buffer line id.
function buildHighlightSpansForLine(buffer: BufferContext, lineId: string, highlight: SyntaxHighlightResult) {
  const lines = buffer.lines()
  const starts = buffer.lineStarts()
  const line = lines.findIndex((entry) => entry.id === lineId)
  if (line < 0) {
    return
  }

  const text = lines[line]?.text ?? ""
  const spans: LineSpan[] = []
  for (const span of highlight.spans) {
    const start = offsetToLineCol(span.start, starts)
    const end = offsetToLineCol(span.end, starts)
    if (start.line !== line || end.line !== line) {
      continue
    }
    spans.push({
      start: toDisplayColumn(text, start.col),
      end: toDisplayColumn(text, end.col),
      styleId: span.styleId,
    })
  }

  spans.sort((a, b) => a.start - b.start || a.end - b.end)
  return { line, spans }
}

// Recalculates highlights for the whole text
export function requestHighlights(buffer: BufferContext) {
  const nextVersion = ++buffer.state.resources.highlightRequestVersion
  buffer.scheduleHighlight(buffer.fullText(), nextVersion)
}

// Watch highlight results and apply them to mounted lines.
export function mountHighlighting(buffer: BufferContext) {
  createEffect(
    on(buffer.highlightResult, (highlight) => {
      if (highlight.version !== buffer.state.resources.highlightRequestVersion) {
        return
      }

      const spansByLine = buildHighlightSpansByLine(buffer, highlight)
      for (let index = 0; index < buffer.lines().length; index++) {
        const ref = getLineRef(buffer, index)
        if (!ref) {
          continue
        }
        applyLineHighlights({
          ref,
          nextSpans: spansByLine.get(index) ?? [],
          syntaxStyle: highlight.syntaxStyle,
          force: false,
        })
      }
    }),
  )
}

// Force one line to refresh from the current highlight result.
export function reapplyLineHighlight(buffer: BufferContext, lineId: string) {
  const highlight = buffer.highlightResult()
  const next = buildHighlightSpansForLine(buffer, lineId, highlight)
  if (!next) {
    return
  }

  const ref = getLineRef(buffer, next.line)
  if (!ref) {
    return
  }

  applyLineHighlights({ ref, nextSpans: next.spans, syntaxStyle: highlight.syntaxStyle, force: true })
}
