import type { Extmark } from "@opentui/core"
import type { SyntaxHighlightResult } from "@utils/syntax-highlighter"
import { createEffect, on } from "solid-js"
import { type LineCharOffset, lineCharOffset } from "./coords"
import type { BufferModel } from "./model"
import { lineCharOffsetToDisplayColumn } from "./text-metrics"

const SYNTAX_EXTMARK_TYPE = "syntax-highlight"

// Highlighted part of texts. Currently implemented with opentui extmarks
export type LineSpan = {
  start: LineCharOffset
  end: LineCharOffset
  styleId: number
}

export type DisplayLineSpan = {
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
      const lines = buffer.lines()
      const lineIndexById = new Map<string, number>()
      const mountedLines = new Set<number>()
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]
        if (!line) {
          continue
        }
        lineIndexById.set(line.id, index)
        if (buffer._lineRefs.has(line.id)) {
          mountedLines.add(index)
        }
      }
      const spansByLine = buildHighlightSpansByLine(buffer, highlight, mountedLines)
      for (const [lineId, ref] of buffer._lineRefs) {
        const index = lineIndexById.get(lineId)
        if (index === undefined) {
          continue
        }
        if (styleChanged) {
          ref.syntaxStyle = highlight.syntaxStyle
        }
        const spans = spansByLine.get(index) ?? []
        applyLineHighlights(buffer, lineId, spans, false)
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

// Highlight spans are cached to skip expensive native extmark reads when the
// highlighter returns the same spans again. Native textarea edits can still move
// or clear extmarks without touching that cache, so edit paths invalidate the
// affected line before applying current or future highlight results.
export function invalidateLineHighlight(buffer: BufferModel, lineId: string) {
  buffer._lineHighlightSpans.delete(lineId)
}

// Convert highlight result into per-line spans.
function buildHighlightSpansByLine(
  buffer: BufferModel,
  highlight: SyntaxHighlightResult,
  targetLines?: ReadonlySet<number>,
) {
  const spansByLine = new Map<number, LineSpan[]>()
  const starts = buffer.lineStarts()
  let line = 0

  for (const span of highlight.spans) {
    while (line + 1 < starts.length && span.start >= starts[line + 1]!) {
      line += 1
    }

    const lineStart = starts[line] ?? 0
    const nextStart = line + 1 < starts.length ? starts[line + 1]! : Number.POSITIVE_INFINITY
    if (span.end > nextStart) {
      continue
    }
    if (targetLines && !targetLines.has(line)) {
      continue
    }

    const spans = spansByLine.get(line) ?? []
    spans.push({
      start: lineCharOffset(span.start - lineStart),
      end: lineCharOffset(span.end - lineStart),
      styleId: span.styleId,
    })
    spansByLine.set(line, spans)
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
  const displaySpans = nextSpans.map((span) => ({
    start: lineCharOffsetToDisplayColumn(buffer, ref.plainText, span.start),
    end: lineCharOffsetToDisplayColumn(buffer, ref.plainText, span.end),
    styleId: span.styleId,
  }))
  // Native text edits can clear/move extmarks without updating our cache; edit
  // paths must invalidate the affected line before this cache-only fast path.
  if (!force && spansEqual(cachedSpans, displaySpans)) {
    return
  }

  const typeId = ref.extmarks.getTypeId(SYNTAX_EXTMARK_TYPE) ?? ref.extmarks.registerType(SYNTAX_EXTMARK_TYPE)
  const currentSpans: Extmark[] = ref.extmarks
    .getAllForTypeId(typeId)
    .sort((a, b) => a.start - b.start || a.end - b.end || a.styleId! - b.styleId! || a.id - b.id)
  const diff = getSpanDiff(currentSpans, displaySpans)

  if (!force && !diff.changed) {
    buffer._lineHighlightSpans.set(lineId, displaySpans)
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

  buffer._lineHighlightSpans.set(lineId, displaySpans)
  ref.requestRender()
}

function getSpanDiff(currentSpans: Extmark[], nextSpans: DisplayLineSpan[]) {
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

function spanEqual(a: DisplayLineSpan | Extmark, b: DisplayLineSpan | Extmark) {
  return a.start === b.start && a.end === b.end && a.styleId === b.styleId
}

function spansEqual(a: DisplayLineSpan[], b: DisplayLineSpan[]) {
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
