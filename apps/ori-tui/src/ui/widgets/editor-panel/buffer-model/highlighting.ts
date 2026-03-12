import type { Extmark } from "@opentui/core"
import { offsetToLineCol } from "@utils/line-offsets"
import type { SyntaxHighlightResult } from "@utils/syntax-highlighter"
import { createEffect, on } from "solid-js"
import type { BufferModel } from "./model"
import { getLineRef } from "./navigation"
import { toDisplayColumn } from "./text-metrics"

const SYNTAX_EXTMARK_TYPE = "syntax-highlight"

// Highlighted part of texts. Currently implemented with opentui extmarks
export type LineSpan = {
  start: number
  end: number
  styleId: number
}

// Recalculates highlights for the whole text
export function requestHighlights(buffer: BufferModel) {
  const nextVersion = ++buffer._highlightRequestVersion
  buffer.scheduleHighlight(buffer.fullText(), nextVersion)
}

// Watch highlight results and apply them to mounted lines.
export function mountHighlighting(buffer: BufferModel) {
  createEffect(
    on(buffer.highlightResult, (highlight) => {
      if (highlight.version !== buffer._highlightRequestVersion) {
        return
      }

      const styleChanged = buffer._syntaxStyle !== highlight.syntaxStyle
      buffer._syntaxStyle = highlight.syntaxStyle
      const spansByLine = buildHighlightSpansByLine(buffer, highlight)
      for (let index = 0; index < buffer.lines().length; index++) {
        const line = buffer.lines()[index]
        if (!line) {
          continue
        }
        const ref = getLineRef(buffer, index)
        if (styleChanged && ref) {
          ref.syntaxStyle = highlight.syntaxStyle
        }
        const spans = spansByLine.get(index) ?? []
        applyLineHighlights(buffer, line.id, spans, false)
      }
    }),
  )
}

// Force one line to refresh from the current highlight result.
export function reapplyLineHighlight(buffer: BufferModel, lineId: string) {
  const highlight = buffer.highlightResult()
  if (highlight.version !== buffer._highlightRequestVersion) {
    return
  }

  buffer._syntaxStyle = highlight.syntaxStyle
  const line = buffer.lines().findIndex((entry) => entry.id === lineId)
  if (line < 0) {
    return
  }

  const spans = buildHighlightSpansByLine(buffer, highlight, new Set([line])).get(line) ?? []
  applyLineHighlights(buffer, lineId, spans, true)
}

// Convert highlight result into per-line spans.
function buildHighlightSpansByLine(
  buffer: BufferModel,
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
      start: toDisplayColumn(lineText, start.col, buffer._widthMethod),
      end: toDisplayColumn(lineText, end.col, buffer._widthMethod),
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
function applyLineHighlights(buffer: BufferModel, lineId: string, nextSpans: LineSpan[], force: boolean) {
  const ref = buffer._lineRefs.get(lineId)
  if (!ref) {
    return
  }

  const cachedSpans = buffer._lineHighlightSpans.get(lineId) ?? []
  if (!force && spansEqual(cachedSpans, nextSpans)) {
    return
  }

  const typeId = ref.extmarks.getTypeId(SYNTAX_EXTMARK_TYPE) ?? ref.extmarks.registerType(SYNTAX_EXTMARK_TYPE)
  const currentSpans: Extmark[] = ref.extmarks
    .getAllForTypeId(typeId)
    .sort((a, b) => a.start - b.start || a.end - b.end || a.styleId! - b.styleId! || a.id - b.id)
  const diff = getSpanDiff(currentSpans, nextSpans)

  if (!force && !diff.changed) {
    buffer._lineHighlightSpans.set(lineId, nextSpans)
    return
  }

  if (diff.changed) {
    for (let i = diff.deleteFrom; i < diff.deleteTo; i++) {
      ref.extmarks.delete(currentSpans[i].id)
    }

    for (const span of diff.spansToAdd) {
      ref.extmarks.create({
        start: span.start,
        end: span.end,
        styleId: span.styleId,
        typeId,
        virtual: false,
      })
    }
  }

  buffer._lineHighlightSpans.set(lineId, nextSpans)
  ref.requestRender()
}

function getSpanDiff(currentSpans: Extmark[], nextSpans: LineSpan[]) {
  const prefixMax = Math.min(currentSpans.length, nextSpans.length)
  let prefix = 0
  while (prefix < prefixMax) {
    if (!spanEqual(currentSpans[prefix], nextSpans[prefix])) {
      break
    }
    prefix += 1
  }

  const suffixMax = Math.min(currentSpans.length - prefix, nextSpans.length - prefix)
  let suffix = 0
  while (suffix < suffixMax) {
    const left = currentSpans[currentSpans.length - 1 - suffix]
    const right = nextSpans[nextSpans.length - 1 - suffix]
    if (!spanEqual(left, right)) {
      break
    }
    suffix += 1
  }

  const retained = prefix + suffix
  return {
    changed: retained !== currentSpans.length || retained !== nextSpans.length,
    deleteFrom: prefix,
    deleteTo: currentSpans.length - suffix,
    spansToAdd: nextSpans.slice(prefix, nextSpans.length - suffix),
  }
}

function spanEqual(a: LineSpan | Extmark, b: LineSpan | Extmark) {
  return a.start === b.start && a.end === b.end && a.styleId === b.styleId
}

function spansEqual(a: LineSpan[], b: LineSpan[]) {
  if (a.length !== b.length) {
    return false
  }
  for (let i = 0; i < a.length; i++) {
    if (!spanEqual(a[i], b[i])) {
      return false
    }
  }
  return true
}
