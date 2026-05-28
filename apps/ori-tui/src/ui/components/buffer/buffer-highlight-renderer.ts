import type { SyntaxHighlightSpan } from "@utils/syntax-highlighter"
import type { StatementEntry } from "./buffer-statement-cache"
import { type DocCharOffset, type DocCharRange, docCharOffset, type LineIndex, lineIndex } from "./coords"
import type { RenderTarget } from "./render-target"
import type { TextGeometry, TextLineGeometry } from "./text-geometry"

function getCachedLineGeometry(params: {
  geometry: TextGeometry
  line: LineIndex
  cache: Map<LineIndex, TextLineGeometry>
}) {
  const cached = params.cache.get(params.line)
  if (cached !== undefined) {
    return cached
  }

  const value = params.geometry.line(params.line)
  params.cache.set(params.line, value)
  return value
}

function collectStatementHighlightSpanLines(params: {
  target: RenderTarget
  span: SyntaxHighlightSpan
  geometry: TextGeometry
  highlightGroupId: number
  lineGeometryCache: Map<LineIndex, TextLineGeometry>
  renderRange: DocCharRange
}) {
  const { target, span, geometry, highlightGroupId, lineGeometryCache, renderRange } = params
  if (span.end <= span.start) {
    return
  }

  const clippedStart = docCharOffset(Math.max(span.start, renderRange.start))
  const clippedEnd = docCharOffset(Math.min(span.end, renderRange.end))
  if (clippedEnd <= clippedStart) {
    return
  }

  const startPosition = geometry.lineAtDocOffset(clippedStart)
  const endPosition = geometry.lineAtDocOffset(docCharOffset(clippedEnd - 1))
  for (let line = Number(startPosition.line.index); line <= endPosition.line.index; line += 1) {
    const lineRef = lineIndex(line)
    const lineGeometry = getCachedLineGeometry({
      geometry,
      line: lineRef,
      cache: lineGeometryCache,
    })
    const start = line === startPosition.line.index ? clippedStart : lineGeometry.start
    const end = line === endPosition.line.index ? clippedEnd : lineGeometry.end
    if (end <= start) {
      continue
    }

    const displayRange = lineGeometry.docRangeDisplayRange(start, end)
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
 * possibly-overlapping span, and then renders each overlapping span line-by-line.
 */
export function renderStatementHighlightRange(params: {
  target: RenderTarget
  statement: StatementEntry
  geometry: TextGeometry
  highlightGroupId: number
  renderRange: DocCharRange
}) {
  const { target, statement, geometry, highlightGroupId, renderRange } = params
  const lineGeometryCache = new Map<LineIndex, TextLineGeometry>()
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

    collectStatementHighlightSpanLines({
      target,
      span,
      geometry,
      highlightGroupId,
      lineGeometryCache,
      renderRange: {
        start: rangeStart,
        end: rangeEnd,
      },
    })
  }
}
