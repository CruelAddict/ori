import type { SyntaxStyle, TextareaRenderable } from "@opentui/core"
import type { SyntaxHighlightResult } from "@shared/lib/syntax-highlighting/syntax-highlighter"

const SYNTAX_EXTMARK_TYPE = "syntax-highlight"

type LineSpan = { start: number; end: number; styleId: number }

function getSyntaxHighlightTypeID(ref: TextareaRenderable) {
  return ref.extmarks.getTypeId(SYNTAX_EXTMARK_TYPE) ?? ref.extmarks.registerType(SYNTAX_EXTMARK_TYPE)
}

function clearSyntaxExtmarks(ref: TextareaRenderable, typeId: number) {
  const marks = ref.extmarks.getAllForTypeId(typeId)
  for (const mark of marks) {
    ref.extmarks.delete(mark.id)
  }
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

function offsetToLineCol(offset: number, lineStarts: number[]): { line: number; col: number } {
  let low = 0
  let high = lineStarts.length - 1
  while (low <= high) {
    const mid = (low + high) >> 1
    const start = lineStarts[mid]
    const nextStart = mid + 1 < lineStarts.length ? lineStarts[mid + 1] : Number.POSITIVE_INFINITY
    if (offset < start) {
      high = mid - 1
      continue
    }
    if (offset >= nextStart) {
      low = mid + 1
      continue
    }
    return { line: mid, col: offset - start }
  }
  return { line: lineStarts.length - 1, col: 0 }
}

function applyLineHighlights(params: {
  ref: TextareaRenderable
  nextSpans: LineSpan[]
  syntaxStyle: SyntaxStyle
  force: boolean
}) {
  const { ref, nextSpans, syntaxStyle, force } = params
  const refState = ref as TextareaRenderable & { syntaxStyle?: SyntaxStyle; __syntaxSpans?: LineSpan[] }
  const prevSpans = refState.__syntaxSpans ?? []
  const styleChanged = refState.syntaxStyle !== syntaxStyle
  const spansChanged = !spansEqual(prevSpans, nextSpans)

  if (!force && !styleChanged && !spansChanged) {
    return
  }

  if (force || spansChanged) {
    const typeId = getSyntaxHighlightTypeID(ref)
    clearSyntaxExtmarks(ref, typeId)
    for (const span of nextSpans) {
      ref.extmarks.create({
        start: span.start,
        end: span.end,
        styleId: span.styleId,
        typeId,
        virtual: false,
      })
    }
    refState.__syntaxSpans = nextSpans.map((span) => ({ ...span }))
  }

  if (force || styleChanged) {
    refState.syntaxStyle = syntaxStyle
  }

  ref.requestRender()
}

export function applySyntaxHighlights(params: {
  spansByLine: Map<number, LineSpan[]>
  syntaxStyle: SyntaxStyle
  lineCount: number
  getLineRef: (index: number) => TextareaRenderable | undefined
}) {
  const { spansByLine, syntaxStyle, lineCount, getLineRef } = params

  for (let index = 0; index < lineCount; index++) {
    const ref = getLineRef(index)
    if (!ref) {
      continue
    }
    const nextSpans = spansByLine.get(index) ?? []
    applyLineHighlights({ ref, nextSpans, syntaxStyle, force: false })
  }
}

export function applySyntaxHighlightsForLine(params: {
  line: number
  spans: LineSpan[]
  syntaxStyle: SyntaxStyle
  getLineRef: (index: number) => TextareaRenderable | undefined
}) {
  const { line, spans, getLineRef, syntaxStyle } = params
  const ref = getLineRef(line)
  if (!ref) {
    return
  }
  applyLineHighlights({ ref, nextSpans: spans, syntaxStyle, force: true })
}

export function forceReapplySyntaxHighlightForLineId(params: {
  lineId: string
  highlight: SyntaxHighlightResult
  lineStarts: number[]
  getLineRef: (index: number) => TextareaRenderable | undefined
  getLineIndexById: (lineId: string) => number
  getLineText: (index: number) => string
  toDisplayColumn: (text: string, column: number) => number
}) {
  const { lineId, highlight, lineStarts, getLineRef, getLineIndexById, getLineText, toDisplayColumn } = params
  const line = getLineIndexById(lineId)
  if (line < 0) {
    return
  }

  const text = getLineText(line)
  const spans: LineSpan[] = []
  for (const span of highlight.spans) {
    const start = offsetToLineCol(span.start, lineStarts)
    const end = offsetToLineCol(span.end, lineStarts)
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
  applySyntaxHighlightsForLine({
    line,
    spans,
    syntaxStyle: highlight.syntaxStyle,
    getLineRef,
  })
}
