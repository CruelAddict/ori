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
  const line = buffer.lines().findIndex((entry) => entry.id === lineId)
  const ref = getLineRef(buffer, line)
  if (!ref) {
    return
  }

  const spans = buildHighlightSpansByLine(buffer, highlight, new Set([line])).get(line) ?? []
  applyLineHighlights({ ref, nextSpans: spans, syntaxStyle: highlight.syntaxStyle, force: true })
}

// Convert highlight result into per-line spans.
function buildHighlightSpansByLine(
  buffer: BufferContext,
  highlight: SyntaxHighlightResult,
  targetLines?: ReadonlySet<number>,
) {
  const spansByLine = new Map<number, LineSpan[]>()
  const lines = buffer.lines()
  const starts = buffer.lineStarts()

  for (const span of highlight.spans) {
    const start = offsetToLineCol(span.start, starts)
    const end = offsetToLineCol(span.end, starts)
    if (start.line !== end.line) {
      continue
    }
    if (targetLines && !targetLines.has(start.line)) {
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
