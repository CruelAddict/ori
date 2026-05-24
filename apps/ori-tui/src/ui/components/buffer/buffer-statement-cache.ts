import type { LineInfo, SyntaxStyle } from "@opentui/core"
import { buildLineStarts, offsetToLine } from "@utils/line-offsets"
import type { SyntaxHighlightSpan } from "@utils/syntax-highlighter"
import { buildChangedStatementReuse } from "./buffer-highlight-reuse"
import { type DocCharOffset, type DocumentVersion, docCharOffset, type LineIndex, lineIndex } from "./coords"
import type { BufferTextChange, Document } from "./document"

export type StatementRange = {
  start: DocCharOffset
  end: DocCharOffset
  startLine: LineIndex
  endLine: LineIndex
}

export type CollectStatements = (text: string, lineStarts: readonly DocCharOffset[]) => StatementRange[]

export type StatementEntry = StatementRange & {
  id: string
  spans: SyntaxHighlightSpan[]
  dirty: boolean
  highlightVersion: number
}

export type StatementCache = {
  version: DocumentVersion | string
  syntaxStyle: SyntaxStyle
  statements: StatementEntry[]
  lineToStatement: number[]
}

export type StatementBatch = {
  startIndex: number
  endIndex: number
  startOffset: DocCharOffset
  endOffset: DocCharOffset
  text: string
}

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

function touchesChangeWindow(statement: StatementRange, start: DocCharOffset, end: DocCharOffset) {
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

function resolveIncrementalReparseStart(previous: readonly StatementEntry[], changeStart: DocCharOffset) {
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
      startOffset: docCharOffset(0),
    }
  }

  return {
    prefixCount: index,
    startOffset: previous[index]?.start ?? docCharOffset(0),
  }
}

function collectIncrementalQueries(
  text: string,
  lineStarts: readonly DocCharOffset[],
  startOffset: DocCharOffset,
  collectStatements: CollectStatements,
) {
  if (startOffset <= 0) {
    return collectStatements(text, lineStarts)
  }

  const tailText = text.slice(startOffset)
  const tailLineStarts = buildLineStarts(tailText).map(docCharOffset)
  const baseLine = offsetToLine(startOffset, lineStarts)
  return collectStatements(tailText, tailLineStarts).map((statement) => ({
    start: docCharOffset(statement.start + startOffset),
    end: docCharOffset(statement.end + startOffset),
    startLine: lineIndex(statement.startLine + baseLine),
    endLine: lineIndex(statement.endLine + baseLine),
  }))
}

function buildIncrementalStatementEntries(params: {
  text: string
  lineStarts: readonly DocCharOffset[]
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
    for (let line = Number(statement.startLine); line <= statement.endLine; line += 1) {
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

function nextHighlightVersion(entry: StatementEntry | undefined, nextStart: DocCharOffset, textChanged: boolean) {
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
  document: Document,
  previous: readonly StatementEntry[],
  previousText: string,
  nextId: () => string,
  syntaxStyle: SyntaxStyle,
  version: DocumentVersion | string,
  change: BufferTextChange | undefined,
  collectStatements: CollectStatements,
): StatementCache {
  const text = document.text
  const lineStarts = document.lineStarts
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

export function getCurrentStatement(cache: StatementCache | undefined, line: LineIndex) {
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
  focusedRow: LineIndex,
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
  focusedRow: LineIndex,
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
  document: Document,
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
    text: document.text.slice(first.start, last.end),
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
