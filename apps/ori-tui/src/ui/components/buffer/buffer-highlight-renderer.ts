import type { SyntaxHighlightSpan } from "@utils/syntax-highlighter"
import type { StatementEntry } from "./buffer-statement-cache"
import {
  type DisplayColumn,
  type DocCharOffset,
  type DocCharRange,
  displayColumn,
  docCharOffset,
  type LineCharOffset,
  type LineIndex,
  lineCharOffset,
  lineDisplayRange,
  lineIndex,
} from "./coords"
import type { RenderTarget } from "./render-target"
import type { TextLayout } from "./text-layout"

type LineHighlightMetrics =
  | {
    kind: "simple"
  }
  | {
    kind: "ascii-tabs"
    columns: DisplayColumn[]
  }
  | {
    kind: "unicode"
    columns: DisplayColumn[]
  }

function isSingleWidthAsciiLine(text: string) {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if (code < 32 || code > 126) {
      return false
    }
  }
  return true
}

function buildLineDisplayHighlightRange(params: {
  startOffset: LineCharOffset
  endOffset: LineCharOffset
  metrics: LineHighlightMetrics
}) {
  const { startOffset, endOffset, metrics } = params
  if (metrics.kind === "simple") {
    return lineDisplayRange(startOffset, endOffset)
  }

  return {
    start: metrics.columns[startOffset] ?? displayColumn(0),
    end: metrics.columns[endOffset] ?? metrics.columns[metrics.columns.length - 1] ?? displayColumn(0),
  }
}

function getCachedLineHighlightMetrics(params: {
  layout: TextLayout
  line: LineIndex
  cache: Map<LineIndex, LineHighlightMetrics>
}) {
  const cached = params.cache.get(params.line)
  if (cached !== undefined) {
    return cached
  }

  const lineText = params.layout.document.lineText(params.line)
  const simple = isSingleWidthAsciiLine(lineText)
  const columns = simple ? undefined : params.layout.asciiTabDisplayColumns(lineText)
  const value = simple
    ? ({ kind: "simple" } satisfies LineHighlightMetrics)
    : columns
      ? ({ kind: "ascii-tabs", columns } satisfies LineHighlightMetrics)
      : ({
        kind: "unicode",
        columns: params.layout.lineDisplayColumns(params.line),
      } satisfies LineHighlightMetrics)
  params.cache.set(params.line, value)
  return value
}

function renderStatementHighlightSpanLines(params: {
  target: RenderTarget
  span: SyntaxHighlightSpan
  layout: TextLayout
  highlightGroupId: number
  lineMetricsCache: Map<LineIndex, LineHighlightMetrics>
  renderRange: DocCharRange
}) {
  const { target, span, layout, highlightGroupId, lineMetricsCache, renderRange } = params
  if (span.end <= span.start) {
    return
  }

  const clippedStart = docCharOffset(Math.max(span.start, renderRange.start))
  const clippedEnd = docCharOffset(Math.min(span.end, renderRange.end))
  if (clippedEnd <= clippedStart) {
    return
  }

  const startCursor = layout.document.lineColAt(clippedStart)
  const endCursor = layout.document.lineColAt(docCharOffset(clippedEnd - 1))
  for (let line = Number(startCursor.line); line <= endCursor.line; line += 1) {
    const lineRef = lineIndex(line)
    const metrics = getCachedLineHighlightMetrics({
      layout,
      line: lineRef,
      cache: lineMetricsCache,
    })
    const lineStart = layout.document.lineStart(lineRef)
    const lineEnd = layout.document.lineEnd(lineRef)
    const start = line === startCursor.line ? clippedStart : lineStart
    const end = line === endCursor.line ? clippedEnd : lineEnd
    if (end <= start) {
      continue
    }

    const startOffset = lineCharOffset(start - lineStart)
    const endOffset = lineCharOffset(Math.min(end, lineEnd) - lineStart)
    const displayRange = buildLineDisplayHighlightRange({
      startOffset,
      endOffset,
      metrics,
    })
    target.addHighlight(lineRef, {
      start: displayRange.start,
      end: displayRange.end,
      styleId: span.styleId,
      groupId: highlightGroupId,
    })
  }
}

function findFirstHighlightSpanIndex(spans: readonly SyntaxHighlightSpan[], startOffset: DocCharOffset) {
  let low = 0
  let high = spans.length

  while (low < high) {
    const mid = (low + high) >> 1
    const spanStart = spans[mid]?.start ?? 0
    if (spanStart < startOffset) {
      low = mid + 1
      continue
    }
    high = mid
  }

  let index = Math.max(0, low - 1)
  while (index > 0 && (spans[index - 1]?.end ?? 0) > startOffset) {
    index -= 1
  }
  return index
}

/**
 * Renders syntax-highlight spans for the visible part of a parsed statement.
 *
 * This first clips the statement to `renderRange`, jumps to the first
 * possibly-overlapping span, and then render seach overlapping span line-by-line.
 */
export function renderStatementHighlightRange(params: {
  target: RenderTarget
  statement: StatementEntry
  layout: TextLayout
  highlightGroupId: number
  renderRange: DocCharRange
}) {
  const { target, statement, layout, highlightGroupId, renderRange } = params
  const lineMetricsCache = new Map<LineIndex, LineHighlightMetrics>()
  const rangeStart = docCharOffset(Math.max(statement.start, renderRange.start))
  const rangeEnd = docCharOffset(Math.min(statement.end, renderRange.end))
  if (rangeEnd <= rangeStart) {
    return
  }

  for (
    let index = findFirstHighlightSpanIndex(statement.spans, rangeStart);
    index < statement.spans.length;
    index += 1
  ) {
    const span = statement.spans[index]
    if (!span) {
      continue
    }
    if (span.end <= rangeStart) {
      continue
    }
    if (span.start >= rangeEnd) {
      break
    }

    renderStatementHighlightSpanLines({
      target,
      span,
      layout,
      highlightGroupId,
      lineMetricsCache,
      renderRange: {
        start: rangeStart,
        end: rangeEnd,
      },
    })
  }
}
