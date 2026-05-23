import type { LineInfo, SyntaxStyle, TextareaRenderable } from "@opentui/core"
import { buildLineStarts, offsetToLine, offsetToLineCol } from "@utils/line-offsets"
import type { SyntaxHighlightSpan } from "@utils/syntax-highlighter"
import type { BufferTextChange } from "./analysis"
import { buildChangedStatementReuse } from "./buffer-highlight-reuse"
import { type DisplayColumn, displayColumn, lineDisplayRange } from "./coords"
import { lineCharOffsetDisplayColumns } from "./text-metrics"

export type StatementRange = {
  start: number
  end: number
  startLine: number
  endLine: number
}

export type CollectStatements = (text: string, lineStarts: readonly number[]) => StatementRange[]

export type StatementEntry = StatementRange & {
  id: string
  spans: SyntaxHighlightSpan[]
  dirty: boolean
  highlightVersion: number
}

export type StatementCache = {
  version: number | string
  syntaxStyle: SyntaxStyle
  statements: StatementEntry[]
  lineToStatement: number[]
}

export type StatementBatch = {
  startIndex: number
  endIndex: number
  startOffset: number
  endOffset: number
  text: string
}

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
  | false

function readStatementText(text: string, statement: StatementRange) {
  return text.slice(statement.start, statement.end)
}

function matchesStatementText(previousText: string, previous: StatementRange, nextText: string, next: StatementRange) {
  return readStatementText(previousText, previous) === readStatementText(nextText, next)
}

function hasExactStatementRange(previous: StatementRange, next: StatementRange) {
  return previous.start === next.start && previous.end === next.end
}

function hasShiftedStatementRange(previous: StatementRange, next: StatementRange, delta: number) {
  return previous.start + delta === next.start && previous.end + delta === next.end
}

function touchesChangeWindow(statement: StatementRange, start: number, end: number) {
  if (start === end) {
    return statement.start <= start && start <= statement.end
  }

  return statement.start < end && start < statement.end
}

function stablePrefixCount(
  previous: readonly StatementEntry[],
  previousText: string,
  next: readonly StatementRange[],
  nextText: string,
) {
  let count = 0
  for (; count < previous.length && count < next.length; count += 1) {
    const entry = previous[count]
    const query = next[count]
    if (!entry || !query) {
      break
    }
    if (!matchesStatementText(previousText, entry, nextText, query)) {
      break
    }
  }
  return count
}

function stableSuffixCount(
  previous: readonly StatementEntry[],
  previousText: string,
  next: readonly StatementRange[],
  prefix: number,
  nextText: string,
) {
  let count = 0
  for (; count < previous.length - prefix && count < next.length - prefix; count += 1) {
    const entry = previous[previous.length - 1 - count]
    const query = next[next.length - 1 - count]
    if (!entry || !query) {
      break
    }
    if (!matchesStatementText(previousText, entry, nextText, query)) {
      break
    }
  }
  return count
}

function buildReusedStatementEntry(entry: StatementEntry, query: StatementRange): StatementEntry {
  return {
    ...query,
    id: entry.id,
    spans: shiftStatementSpans(entry.spans, query.start - entry.start),
    dirty: needsStatementHighlight(entry),
    highlightVersion: nextHighlightVersion(entry, query.start, false),
  }
}

function buildChangedStatementEntry(params: {
  previousEntry: StatementEntry | undefined
  previousText: string
  query: StatementRange
  text: string
  nextId: () => string
}) {
  const { previousEntry, previousText, query, text, nextId } = params
  const nextText = text.slice(query.start, query.end)
  const previousStatementText = previousEntry ? previousText.slice(previousEntry.start, previousEntry.end) : undefined
  const textChanged = previousStatementText !== nextText
  const reuse =
    previousEntry && previousStatementText
      ? buildChangedStatementReuse({
          previousText: previousStatementText,
          nextText,
          previousSpans: localizeStatementSpans(previousEntry.spans, previousEntry.start),
        })
      : undefined

  return {
    ...query,
    id: previousEntry?.id ?? nextId(),
    spans: reuse ? absolutizeStatementSpans(reuse.spans, query.start) : [],
    dirty: textChanged || needsStatementHighlight(previousEntry),
    highlightVersion: nextHighlightVersion(previousEntry, query.start, textChanged),
  } satisfies StatementEntry
}

function reconcileStatementEntries(params: {
  previous: readonly StatementEntry[]
  previousText: string
  queries: readonly StatementRange[]
  text: string
  nextId: () => string
}) {
  const { previous, previousText, queries, text, nextId } = params
  const prefix = stablePrefixCount(previous, previousText, queries, text)
  const suffix = stableSuffixCount(previous, previousText, queries, prefix, text)
  const statements = new Array<StatementEntry>(queries.length)

  for (let index = 0; index < prefix; index += 1) {
    const query = queries[index]
    const entry = previous[index]
    if (!query || !entry) {
      continue
    }
    statements[index] = buildReusedStatementEntry(entry, query)
  }

  const middlePreviousStart = prefix
  const middlePreviousEnd = previous.length - suffix
  const middleNextEnd = queries.length - suffix
  const middlePreviousCount = middlePreviousEnd - middlePreviousStart
  for (let index = prefix; index < middleNextEnd; index += 1) {
    const query = queries[index]
    if (!query) {
      continue
    }
    const previousOffset = index - prefix
    const previousEntry =
      previousOffset < middlePreviousCount ? previous[middlePreviousStart + previousOffset] : undefined
    statements[index] = buildChangedStatementEntry({
      previousEntry,
      previousText,
      query,
      text,
      nextId,
    })
  }

  for (let offset = suffix; offset > 0; offset -= 1) {
    const index = queries.length - offset
    const query = queries[index]
    const entry = previous[middlePreviousEnd + (index - middleNextEnd)]
    if (!query || !entry) {
      continue
    }
    statements[index] = buildReusedStatementEntry(entry, query)
  }

  return statements
}

function reconcileIncrementalStatementEntries(params: {
  previous: readonly StatementEntry[]
  previousText: string
  queries: readonly StatementRange[]
  text: string
  nextId: () => string
  change: BufferTextChange
}) {
  const { previous, previousText, queries, text, nextId, change } = params
  const delta = change.nextEnd - change.previousEnd
  const statements = new Array<StatementEntry>(queries.length)
  let prefix = 0

  for (; prefix < previous.length && prefix < queries.length; prefix += 1) {
    const entry = previous[prefix]
    const query = queries[prefix]
    if (!entry || !query) {
      break
    }
    if (entry.end > change.start) {
      break
    }
    if (!hasExactStatementRange(entry, query)) {
      break
    }
    if (!matchesStatementText(previousText, entry, text, query)) {
      break
    }

    statements[prefix] = buildReusedStatementEntry(entry, query)
  }

  let suffix = 0
  for (; suffix < previous.length - prefix && suffix < queries.length - prefix; suffix += 1) {
    const previousIndex = previous.length - 1 - suffix
    const nextIndex = queries.length - 1 - suffix
    const entry = previous[previousIndex]
    const query = queries[nextIndex]
    if (!entry || !query) {
      break
    }
    if (entry.start < change.previousEnd || query.start < change.nextEnd) {
      break
    }
    if (!hasShiftedStatementRange(entry, query, delta)) {
      break
    }
    if (!matchesStatementText(previousText, entry, text, query)) {
      break
    }

    statements[nextIndex] = buildReusedStatementEntry(entry, query)
  }

  const middlePreviousEnd = previous.length - suffix
  const middleNextEnd = queries.length - suffix
  let middleStart = prefix
  const middleEntry = prefix < middlePreviousEnd ? previous[prefix] : undefined
  const middleQuery = prefix < middleNextEnd ? queries[prefix] : undefined
  const canReuseChangedEntry =
    !!middleEntry &&
    !!middleQuery &&
    touchesChangeWindow(middleEntry, change.start, change.previousEnd) &&
    touchesChangeWindow(middleQuery, change.start, change.nextEnd)

  if (canReuseChangedEntry && middleEntry && middleQuery) {
    statements[prefix] = buildChangedStatementEntry({
      previousEntry: middleEntry,
      previousText,
      query: middleQuery,
      text,
      nextId,
    })
    middleStart += 1
  }

  for (let index = middleStart; index < middleNextEnd; index += 1) {
    const query = queries[index]
    if (!query) {
      continue
    }

    statements[index] = buildChangedStatementEntry({
      previousEntry: undefined,
      previousText,
      query,
      text,
      nextId,
    })
  }

  return statements
}

function resolveIncrementalReparseStart(previous: readonly StatementEntry[], changeStart: number) {
  let index = -1

  for (let i = 0; i < previous.length; i += 1) {
    const statement = previous[i]
    if (!statement) {
      continue
    }
    if (statement.start > changeStart) {
      break
    }
    index = i
  }

  if (index < 0) {
    return {
      prefixCount: 0,
      startOffset: 0,
    }
  }

  return {
    prefixCount: index,
    startOffset: previous[index]?.start ?? 0,
  }
}

function collectIncrementalQueries(
  text: string,
  lineStarts: number[],
  startOffset: number,
  collectStatements: CollectStatements,
) {
  if (startOffset <= 0) {
    return collectStatements(text, lineStarts)
  }

  const tailText = text.slice(startOffset)
  const tailLineStarts = buildLineStarts(tailText)
  const baseLine = offsetToLine(startOffset, lineStarts)
  return collectStatements(tailText, tailLineStarts).map((statement) => ({
    start: statement.start + startOffset,
    end: statement.end + startOffset,
    startLine: statement.startLine + baseLine,
    endLine: statement.endLine + baseLine,
  }))
}

function buildIncrementalStatementEntries(params: {
  text: string
  lineStarts: number[]
  previous: readonly StatementEntry[]
  previousText: string
  nextId: () => string
  change: BufferTextChange
  collectStatements: CollectStatements
}) {
  const { text, lineStarts, previous, previousText, nextId, change, collectStatements } = params
  const start = resolveIncrementalReparseStart(previous, change.start)
  const prefix = previous.slice(0, start.prefixCount).map((entry) => buildReusedStatementEntry(entry, entry))
  const tail = reconcileIncrementalStatementEntries({
    previous: previous.slice(start.prefixCount),
    previousText,
    queries: collectIncrementalQueries(text, lineStarts, start.startOffset, collectStatements),
    text,
    nextId,
    change,
  })

  return [...prefix, ...tail]
}

function buildStatementLineMap(statements: readonly StatementRange[], lineCount: number) {
  const lines = Array.from({ length: lineCount }, () => -1)
  statements.forEach((statement, index) => {
    for (let line = statement.startLine; line <= statement.endLine; line += 1) {
      lines[line] = index
    }
  })
  return lines
}

function shiftStatementSpans(spans: readonly SyntaxHighlightSpan[], delta: number) {
  if (delta === 0) {
    return [...spans]
  }

  return spans.map((span) => ({
    start: span.start + delta,
    end: span.end + delta,
    styleId: span.styleId,
  }))
}

function localizeStatementSpans(spans: readonly SyntaxHighlightSpan[], start: number) {
  return spans.map((span) => ({
    start: span.start - start,
    end: span.end - start,
    styleId: span.styleId,
  }))
}

function absolutizeStatementSpans(spans: readonly SyntaxHighlightSpan[], start: number) {
  return spans.map((span) => ({
    start: span.start + start,
    end: span.end + start,
    styleId: span.styleId,
  }))
}

function nextHighlightVersion(entry: StatementEntry | undefined, nextStart: number, textChanged: boolean) {
  if (!entry) {
    return 0
  }
  if (textChanged || entry.start !== nextStart) {
    return entry.highlightVersion + 1
  }

  return entry.highlightVersion
}

function needsStatementHighlight(entry: StatementEntry | undefined) {
  if (!entry) {
    return true
  }
  if (entry.dirty) {
    return true
  }

  return entry.highlightVersion === 0 && entry.spans.length === 0
}

export function buildStatementCache(
  text: string,
  lineStarts: number[],
  previous: readonly StatementEntry[],
  previousText: string,
  nextId: () => string,
  syntaxStyle: SyntaxStyle,
  version: number,
  change: BufferTextChange | undefined,
  collectStatements: CollectStatements,
): StatementCache {
  const statements =
    change && previous.length > 0
      ? buildIncrementalStatementEntries({
          text,
          lineStarts,
          previous,
          previousText,
          nextId,
          change,
          collectStatements,
        })
      : reconcileStatementEntries({
          previous,
          previousText,
          queries: collectStatements(text, lineStarts),
          text,
          nextId,
        })

  return {
    version,
    syntaxStyle,
    statements,
    lineToStatement: buildStatementLineMap(statements, lineStarts.length),
  }
}

export function getLineText(text: string, starts: readonly number[], line: number) {
  const start = starts[line] ?? 0
  const next = line + 1 < starts.length ? (starts[line + 1] ?? text.length) : text.length
  const end = next > start && text[next - 1] === "\n" ? next - 1 : next
  return text.slice(start, end)
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
  startOffset: number
  endOffset: number
  metrics: LineHighlightMetrics
}) {
  const { startOffset, endOffset, metrics } = params
  if (metrics?.kind === "simple") {
    return lineDisplayRange(startOffset, endOffset)
  }
  if (metrics) {
    return {
      start: metrics.columns[startOffset] ?? displayColumn(0),
      end: metrics.columns[endOffset] ?? metrics.columns[metrics.columns.length - 1] ?? displayColumn(0),
    }
  }

  return lineDisplayRange(startOffset, endOffset)
}

function getCachedLineHighlightMetrics(params: {
  text: string
  starts: readonly number[]
  line: number
  tabWidth: number
  widthMethod: TextareaRenderable["ctx"] extends { widthMethod?: infer T } ? T : never
  cache: Map<number, LineHighlightMetrics>
}) {
  const cached = params.cache.get(params.line)
  if (cached !== undefined) {
    return cached
  }

  const lineText = getLineText(params.text, params.starts, params.line)
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

export function getCurrentStatement(cache: StatementCache | undefined, line: number) {
  if (!cache) {
    return undefined
  }

  const index = cache.lineToStatement[line]
  if (index === undefined || index < 0) {
    return undefined
  }

  return cache.statements[index]
}

export function hasDirtyStatements(cache: StatementCache | undefined) {
  if (!cache) {
    return false
  }

  return cache.statements.some((statement) => statement.dirty)
}

export function collectVisibleStatementIndices(
  cache: StatementCache | undefined,
  info: LineInfo,
  scrollY: number,
  height: number,
  focusedRow: number,
  overscan: number,
) {
  if (!cache) {
    return [] as number[]
  }

  const startRow = Math.max(0, scrollY - overscan)
  const endRow = Math.min(info.lineSources.length, scrollY + height + overscan)
  const seen = new Set<number>()
  const indices: number[] = []
  const pushIndex = (index: number | undefined) => {
    if (index === undefined || index < 0 || seen.has(index)) {
      return
    }

    seen.add(index)
    indices.push(index)
  }

  for (let row = startRow; row < endRow; row += 1) {
    const line = info.lineSources[row]
    if (line === undefined) {
      continue
    }
    pushIndex(cache.lineToStatement[line])
  }

  pushIndex(cache.lineToStatement[focusedRow])
  return indices
}

export function collectVisibleStatements(
  cache: StatementCache | undefined,
  info: LineInfo,
  scrollY: number,
  height: number,
  focusedRow: number,
  overscan: number,
) {
  if (!cache) {
    return [] as StatementEntry[]
  }

  return collectVisibleStatementIndices(cache, info, scrollY, height, focusedRow, overscan)
    .map((index) => cache.statements[index])
    .filter((statement): statement is StatementEntry => !!statement)
}

export function buildStatementBatch(
  cache: StatementCache | undefined,
  text: string,
  startIndex: number,
  endIndex: number,
) {
  if (!cache) {
    return undefined
  }

  const first = cache.statements[startIndex]
  const last = cache.statements[endIndex]
  if (!first || !last || startIndex > endIndex) {
    return undefined
  }

  return {
    startIndex,
    endIndex,
    startOffset: first.start,
    endOffset: last.end,
    text: text.slice(first.start, last.end),
  } satisfies StatementBatch
}

export function applyStatementBatch(
  cache: StatementCache | undefined,
  batch: StatementBatch,
  spans: readonly SyntaxHighlightSpan[],
) {
  if (!cache) {
    return
  }

  for (let index = batch.startIndex; index <= batch.endIndex; index += 1) {
    const statement = cache.statements[index]
    if (!statement) {
      continue
    }

    const nextSpans: SyntaxHighlightSpan[] = []
    for (const span of spans) {
      const absoluteStart = batch.startOffset + span.start
      const absoluteEnd = batch.startOffset + span.end
      const start = Math.max(absoluteStart, statement.start)
      const end = Math.min(absoluteEnd, statement.end)
      if (end <= start) {
        continue
      }

      nextSpans.push({
        start: start - statement.start,
        end: end - statement.start,
        styleId: span.styleId,
      })
    }

    statement.spans = nextSpans.map((span) => ({
      start: span.start + statement.start,
      end: span.end + statement.start,
      styleId: span.styleId,
    }))
    statement.dirty = false
    statement.highlightVersion += 1
  }
}

function addStatementHighlightSpanLines(params: {
  ref: TextareaRenderable
  span: SyntaxHighlightSpan
  starts: readonly number[]
  text: string
  tabWidth: number
  highlightGroupId: number
  lineMetricsCache: Map<number, LineHighlightMetrics>
  visibleStartOffset?: number
  visibleEndOffset?: number
}) {
  const {
    ref,
    span,
    starts,
    text,
    tabWidth,
    highlightGroupId,
    lineMetricsCache,
    visibleStartOffset,
    visibleEndOffset,
  } = params
  if (span.end <= span.start) {
    return
  }

  const clippedStart = visibleStartOffset === undefined ? span.start : Math.max(span.start, visibleStartOffset)
  const clippedEnd = visibleEndOffset === undefined ? span.end : Math.min(span.end, visibleEndOffset)
  if (clippedEnd <= clippedStart) {
    return
  }

  const startCursor = offsetToLineCol(clippedStart, starts)
  const endCursor = offsetToLineCol(clippedEnd - 1, starts)
  for (let line = startCursor.line; line <= endCursor.line; line += 1) {
    const metrics = getCachedLineHighlightMetrics({
      text,
      starts,
      line,
      tabWidth,
      widthMethod: ref.ctx?.widthMethod,
      cache: lineMetricsCache,
    })
    const lineStart = starts[line] ?? 0
    const nextLineStart = line + 1 < starts.length ? (starts[line + 1] ?? text.length) : text.length
    const lineEnd = nextLineStart > lineStart && text[nextLineStart - 1] === "\n" ? nextLineStart - 1 : nextLineStart
    const start = line === startCursor.line ? clippedStart : lineStart
    const end = line === endCursor.line ? clippedEnd : lineEnd
    if (end <= start) {
      continue
    }

    const startOffset = start - lineStart
    const endOffset = Math.min(end, lineEnd) - lineStart
    const displayRange = buildLineDisplayHighlightRange({
      startOffset,
      endOffset,
      metrics,
    })
    ref.editBuffer.addHighlight(line, {
      start: displayRange.start,
      end: displayRange.end,
      styleId: span.styleId,
      hlRef: highlightGroupId,
    })
  }
}

function findFirstHighlightSpanIndex(spans: readonly SyntaxHighlightSpan[], startOffset: number) {
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
  starts: readonly number[]
  text: string
  tabWidth: number
  highlightGroupId: number
  visibleStartOffset?: number
  visibleEndOffset?: number
}) {
  const { ref, statement, starts, text, tabWidth, highlightGroupId, visibleStartOffset, visibleEndOffset } = params
  const lineMetricsCache = new Map<number, LineHighlightMetrics>()
  const rangeStart = visibleStartOffset === undefined ? statement.start : Math.max(statement.start, visibleStartOffset)
  const rangeEnd = visibleEndOffset === undefined ? statement.end : Math.min(statement.end, visibleEndOffset)
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
      starts,
      text,
      tabWidth,
      highlightGroupId,
      lineMetricsCache,
      visibleStartOffset: rangeStart,
      visibleEndOffset: rangeEnd,
    })
  }
}
