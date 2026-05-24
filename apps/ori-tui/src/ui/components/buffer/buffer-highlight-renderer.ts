import type { TextareaRenderable } from "@opentui/core"
import type { SyntaxHighlightSpan } from "@utils/syntax-highlighter"
import type { StatementEntry } from "./buffer-statement-cache"
import {
  type DisplayColumn,
  type DocCharOffset,
  displayColumn,
  docCharOffset,
  type LineCharOffset,
  type LineIndex,
  lineCharOffset,
  lineDisplayRange,
  lineIndex,
} from "./coords"
import type { Document } from "./document"
import { lineCharOffsetDisplayColumns } from "./text-metrics"

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

function buildAsciiTabColumns(text: string, tabWidth: number) {
  const columns = new Array<DisplayColumn>(text.length + 1)
  let column = 0
  columns[0] = displayColumn(0)
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if (code === 9) {
      column += tabWidth - (column % tabWidth)
      columns[i + 1] = displayColumn(column)
      continue
    }
    if (code < 32 || code > 126) {
      return undefined
    }
    column += 1
    columns[i + 1] = displayColumn(column)
  }
  return columns
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
  document: Document
  line: LineIndex
  tabWidth: number
  widthMethod: TextareaRenderable["ctx"] extends { widthMethod?: infer T } ? T : never
  cache: Map<LineIndex, LineHighlightMetrics>
}) {
  const cached = params.cache.get(params.line)
  if (cached !== undefined) {
    return cached
  }

  const lineText = params.document.lineText(params.line)
  const simple = isSingleWidthAsciiLine(lineText)
  const columns = simple ? undefined : buildAsciiTabColumns(lineText, params.tabWidth)
  const value = simple
    ? ({ kind: "simple" } satisfies LineHighlightMetrics)
    : columns
      ? ({ kind: "ascii-tabs", columns } satisfies LineHighlightMetrics)
      : ({
          kind: "unicode",
          columns: lineCharOffsetDisplayColumns(
            { tabWidth: params.tabWidth, widthMethod: params.widthMethod },
            lineText,
          ),
        } satisfies LineHighlightMetrics)
  params.cache.set(params.line, value)
  return value
}

function addStatementHighlightSpanLines(params: {
  ref: TextareaRenderable
  span: SyntaxHighlightSpan
  document: Document
  tabWidth: number
  highlightGroupId: number
  lineMetricsCache: Map<LineIndex, LineHighlightMetrics>
  visibleStartOffset?: DocCharOffset
  visibleEndOffset?: DocCharOffset
}) {
  const { ref, span, document, tabWidth, highlightGroupId, lineMetricsCache, visibleStartOffset, visibleEndOffset } =
    params
  if (span.end <= span.start) {
    return
  }

  const clippedStart = docCharOffset(
    visibleStartOffset === undefined ? span.start : Math.max(span.start, visibleStartOffset),
  )
  const clippedEnd = docCharOffset(visibleEndOffset === undefined ? span.end : Math.min(span.end, visibleEndOffset))
  if (clippedEnd <= clippedStart) {
    return
  }

  const startCursor = document.lineColAt(clippedStart)
  const endCursor = document.lineColAt(docCharOffset(clippedEnd - 1))
  for (let line = Number(startCursor.line); line <= endCursor.line; line += 1) {
    const lineRef = lineIndex(line)
    const metrics = getCachedLineHighlightMetrics({
      document,
      line: lineRef,
      tabWidth,
      widthMethod: ref.ctx?.widthMethod,
      cache: lineMetricsCache,
    })
    const lineStart = document.lineStart(lineRef)
    const lineEnd = document.lineEnd(lineRef)
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
    ref.editBuffer.addHighlight(lineRef, {
      start: displayRange.start,
      end: displayRange.end,
      styleId: span.styleId,
      hlRef: highlightGroupId,
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

export function addStatementHighlightRange(params: {
  ref: TextareaRenderable
  statement: StatementEntry
  document: Document
  tabWidth: number
  highlightGroupId: number
  visibleStartOffset?: DocCharOffset
  visibleEndOffset?: DocCharOffset
}) {
  const { ref, statement, document, tabWidth, highlightGroupId, visibleStartOffset, visibleEndOffset } = params
  const lineMetricsCache = new Map<LineIndex, LineHighlightMetrics>()
  const rangeStart = docCharOffset(
    visibleStartOffset === undefined ? statement.start : Math.max(statement.start, visibleStartOffset),
  )
  const rangeEnd = docCharOffset(
    visibleEndOffset === undefined ? statement.end : Math.min(statement.end, visibleEndOffset),
  )
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

    addStatementHighlightSpanLines({
      ref,
      span,
      document,
      tabWidth,
      highlightGroupId,
      lineMetricsCache,
      visibleStartOffset: rangeStart,
      visibleEndOffset: rangeEnd,
    })
  }
}
