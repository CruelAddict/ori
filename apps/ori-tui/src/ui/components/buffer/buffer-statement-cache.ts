import type { LineInfo, SyntaxStyle, TextareaRenderable } from "@opentui/core"
import { offsetToLineCol } from "@utils/line-offsets"
import type { SyntaxHighlightSpan } from "@utils/syntax-highlighter"
import { collectSqlQueries, type SqlStatement } from "../../widgets/editor-panel/sql-statement-detector"
import { shouldReuseChangedStatementSpans } from "./buffer-highlight-reuse"
import { lineCharOffset } from "./buffer-model/coords"
import { lineCharOffsetToDisplayColumn } from "./buffer-model/text-metrics"

export type StatementEntry = SqlStatement & {
  id: string
  text: string
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

function stablePrefixCount(previous: readonly StatementEntry[], next: readonly SqlStatement[], text: string) {
  let count = 0
  for (; count < previous.length && count < next.length; count += 1) {
    const entry = previous[count]
    const query = next[count]
    if (!entry || !query) {
      break
    }
    if (entry.text !== text.slice(query.start, query.end)) {
      break
    }
  }
  return count
}

function stableSuffixCount(
  previous: readonly StatementEntry[],
  next: readonly SqlStatement[],
  prefix: number,
  text: string,
) {
  let count = 0
  for (; count < previous.length - prefix && count < next.length - prefix; count += 1) {
    const entry = previous[previous.length - 1 - count]
    const query = next[next.length - 1 - count]
    if (!entry || !query) {
      break
    }
    if (entry.text !== text.slice(query.start, query.end)) {
      break
    }
  }
  return count
}

function buildStatementLineMap(statements: readonly SqlStatement[], lineCount: number) {
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
  nextId: () => string,
  syntaxStyle: SyntaxStyle,
  version: number,
): StatementCache {
  const queries = collectSqlQueries(text, lineStarts)
  const prefix = stablePrefixCount(previous, queries, text)
  const suffix = stableSuffixCount(previous, queries, prefix, text)
  const statements = new Array<StatementEntry>(queries.length)

  for (let index = 0; index < prefix; index += 1) {
    const query = queries[index]
    const entry = previous[index]
    if (!query || !entry) {
      continue
    }
    statements[index] = {
      ...query,
      id: entry.id,
      text: text.slice(query.start, query.end),
      spans: shiftStatementSpans(entry.spans, query.start - entry.start),
      dirty: needsStatementHighlight(entry),
      highlightVersion: entry.highlightVersion,
    }
  }

  const middlePreviousStart = prefix
  const middlePreviousEnd = previous.length - suffix
  const middleNextEnd = queries.length - suffix
  for (let index = prefix; index < middleNextEnd; index += 1) {
    const query = queries[index]
    if (!query) {
      continue
    }
    const previousEntry = previous[middlePreviousStart + (index - prefix)]
    const nextText = text.slice(query.start, query.end)
    const reuseSpans = !!previousEntry && shouldReuseChangedStatementSpans(previousEntry.text, nextText)
    statements[index] = {
      ...query,
      id: previousEntry?.id ?? nextId(),
      text: nextText,
      spans:
        reuseSpans && previousEntry ? shiftStatementSpans(previousEntry.spans, query.start - previousEntry.start) : [],
      dirty: previousEntry?.text !== nextText || needsStatementHighlight(previousEntry),
      highlightVersion: previousEntry
        ? reuseSpans
          ? previousEntry.highlightVersion
          : previousEntry.highlightVersion + 1
        : 0,
    }
  }

  for (let offset = suffix; offset > 0; offset -= 1) {
    const index = queries.length - offset
    const query = queries[index]
    const entry = previous[middlePreviousEnd + (index - middleNextEnd)]
    if (!query || !entry) {
      continue
    }
    statements[index] = {
      ...query,
      id: entry.id,
      text: text.slice(query.start, query.end),
      spans: shiftStatementSpans(entry.spans, query.start - entry.start),
      dirty: needsStatementHighlight(entry),
      highlightVersion: entry.highlightVersion,
    }
  }

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

export function addStatementHighlightSpanLines(params: {
  ref: TextareaRenderable
  span: SyntaxHighlightSpan
  starts: readonly number[]
  text: string
  tabWidth: number
  hlRef: number
}) {
  const { ref, span, starts, text, tabWidth, hlRef } = params
  if (span.end <= span.start) {
    return
  }

  const startCursor = offsetToLineCol(span.start, starts)
  const endCursor = offsetToLineCol(span.end - 1, starts)

  for (let line = startCursor.line; line <= endCursor.line; line += 1) {
    const lineStart = starts[line] ?? 0
    const lineText = getLineText(text, starts, line)
    const lineEnd = lineStart + lineText.length
    const startOffset = Math.max(span.start, lineStart) - lineStart
    const endOffset = Math.min(span.end, lineEnd) - lineStart
    if (endOffset <= startOffset) {
      continue
    }

    ref.editBuffer.addHighlight(line, {
      start: lineCharOffsetToDisplayColumn(
        { tabWidth, widthMethod: ref.ctx?.widthMethod },
        lineText,
        lineCharOffset(startOffset),
      ),
      end: lineCharOffsetToDisplayColumn(
        { tabWidth, widthMethod: ref.ctx?.widthMethod },
        lineText,
        lineCharOffset(endOffset),
      ),
      styleId: span.styleId,
      hlRef,
    })
  }
}
