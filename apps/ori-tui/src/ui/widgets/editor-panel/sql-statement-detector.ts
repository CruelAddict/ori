import { type DocCharOffset, docCharOffset, type LineIndex, lineIndex } from "@ui/components/buffer/coords"
import { offsetToLine } from "../../../utils/line-offsets"

export type SqlStatement = {
  start: DocCharOffset
  end: DocCharOffset
  startLine: LineIndex
  endLine: LineIndex
}

export type SqlQueryResolution =
  | { kind: "query"; query: SqlStatement }
  | { kind: "ambiguous"; queries: SqlStatement[] }
  | { kind: "none" }

export type SqlDocumentAnalysis = {
  queries: SqlStatement[]
  queryIndicesByLine: number[][]
}

type Span = { start: number; end: number }

type ParseState =
  | { kind: "normal" }
  | { kind: "line-comment" }
  | { kind: "block-comment" }
  | { kind: "single-quote" }
  | { kind: "double-quote" }
  | { kind: "dollar-quote"; tag: string }

type StatementRoot = "none" | "query" | "insert" | "create" | "other"

type StatementContinuation =
  | { kind: "with-consumer" }
  | { kind: "insert-source" }
  | { kind: "insert-default-values" }
  | { kind: "query-root" }
  | { kind: "create-as-query" }
  | { kind: "explain-statement" }

type CreateMode = "none" | "pending-kind" | "materialized" | "query-capable" | "other"

type StatementScanState = {
  root: StatementRoot
  continuation: StatementContinuation | undefined
  createMode: CreateMode
  inQueryBody: boolean
}

const WHITESPACE_RE = /\s/

const QUERY_START_KEYWORDS = new Set(["with", "select", "values"])
const WITH_CONSUMER_KEYWORDS = new Set(["select", "values", "insert", "update", "delete"])
const QUERY_COMPOUND_KEYWORDS = new Set(["union", "intersect", "except"])
const CREATE_PREFIX_KEYWORDS = new Set(["temp", "temporary", "or", "replace", "if", "not", "exists"])

const SQL_START_KEYWORDS = new Set(
  [
    "with",
    "select",
    "values",
    "insert",
    "update",
    "delete",
    "create",
    "alter",
    "drop",
    "truncate",
    "begin",
    "commit",
    "rollback",
    "grant",
    "revoke",
    "call",
    "explain",
    "analyze",
    "show",
    "describe",
    "use",
    "pragma",
    "vacuum",
    "attach",
    "detach",
  ].map((word) => word.toLowerCase()),
)

function isGoBatchLine(line: string) {
  return /^go(?:\s*--.*)?$/i.test(line)
}

function startsDollarTag(text: string, index: number): string | undefined {
  if (text[index] !== "$") {
    return undefined
  }
  let j = index + 1
  while (j < text.length && /[A-Za-z0-9_]/.test(text[j])) {
    j++
  }
  if (text[j] !== "$") {
    return undefined
  }
  return text.slice(index, j + 1)
}

function findStatementTokenStart(text: string, span: Span): number | undefined {
  let i = span.start

  while (i < span.end) {
    while (i < span.end && WHITESPACE_RE.test(text[i]!)) {
      i++
    }

    if (text.startsWith("--", i)) {
      i += 2
      while (i < span.end && text[i] !== "\n") {
        i++
      }
      continue
    }

    if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2)
      if (end === -1 || end + 2 > span.end) {
        return undefined
      }
      i = end + 2
      continue
    }

    if (text[i] === ";") {
      i++
      continue
    }

    break
  }

  return i < span.end ? i : undefined
}

function getLeadingToken(text: string, span: Span): { tokenStart: number; token: string } | undefined {
  const tokenStart = findStatementTokenStart(text, span)
  if (tokenStart === undefined) {
    return undefined
  }
  const tokenMatch = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(text.slice(tokenStart, span.end))
  if (!tokenMatch) {
    return undefined
  }
  return { tokenStart, token: tokenMatch[0]!.toLowerCase() }
}

function hasNonWhitespace(text: string, start: number, end: number): boolean {
  for (let i = start; i < end; i++) {
    if (!WHITESPACE_RE.test(text[i]!)) {
      return true
    }
  }
  return false
}

function buildQueryIndicesByLine(queries: SqlStatement[], lineCount: number) {
  const lines = Array.from({ length: lineCount }, () => [] as number[])

  queries.forEach((query, index) => {
    for (let line = Number(query.startLine); line <= query.endLine; line += 1) {
      lines[line]?.push(index)
    }
  })

  return lines
}

function createStatementScanState(): StatementScanState {
  return {
    root: "none",
    continuation: undefined,
    createMode: "none",
    inQueryBody: false,
  }
}

function applyStatementRoot(state: StatementScanState, token: string) {
  state.inQueryBody = false
  state.createMode = "none"

  if (token === "with") {
    state.root = "other"
    state.continuation = { kind: "with-consumer" }
    return
  }

  if (token === "select" || token === "values") {
    state.root = "query"
    state.continuation = undefined
    state.inQueryBody = true
    return
  }

  if (token === "insert") {
    state.root = "insert"
    state.continuation = { kind: "insert-source" }
    return
  }

  if (token === "create") {
    state.root = "create"
    state.continuation = undefined
    state.createMode = "pending-kind"
    return
  }

  if (token === "explain") {
    state.root = "other"
    state.continuation = { kind: "explain-statement" }
    return
  }

  state.root = "other"
  state.continuation = undefined
}

function advanceCreateMode(state: StatementScanState, token: string) {
  if (state.root !== "create") {
    return
  }

  if (state.createMode === "pending-kind") {
    if (CREATE_PREFIX_KEYWORDS.has(token)) {
      return
    }
    if (token === "materialized") {
      state.createMode = "materialized"
      return
    }
    if (token === "table" || token === "view") {
      state.createMode = "query-capable"
      return
    }
    state.createMode = "other"
    return
  }

  if (state.createMode === "materialized") {
    state.createMode = token === "view" ? "query-capable" : "other"
    return
  }

  if (state.createMode !== "query-capable") {
    return
  }

  if (token === "as") {
    state.continuation = { kind: "create-as-query" }
  }
}

function consumeStatementContinuation(state: StatementScanState, token: string) {
  const continuation = state.continuation
  if (!continuation) {
    return false
  }

  if (continuation.kind === "insert-source") {
    if (token === "default") {
      state.continuation = { kind: "insert-default-values" }
      return true
    }
    if (token === "with") {
      state.continuation = { kind: "with-consumer" }
      return true
    }
    if (token === "select") {
      state.continuation = undefined
      state.inQueryBody = true
      return true
    }
    if (token === "values") {
      state.continuation = undefined
      return true
    }
    return false
  }

  if (continuation.kind === "insert-default-values") {
    if (token !== "values") {
      return false
    }
    state.continuation = undefined
    return true
  }

  if (continuation.kind === "with-consumer") {
    if (!WITH_CONSUMER_KEYWORDS.has(token)) {
      return false
    }
    applyStatementRoot(state, token)
    return true
  }

  if (continuation.kind === "query-root" || continuation.kind === "create-as-query") {
    if (!QUERY_START_KEYWORDS.has(token)) {
      return false
    }
    applyStatementRoot(state, token)
    return true
  }

  if (continuation.kind === "explain-statement") {
    if (token === "analyze") {
      return true
    }
    if (!SQL_START_KEYWORDS.has(token)) {
      return false
    }
    applyStatementRoot(state, token)
    return true
  }

  return false
}

function updateStatementScanState(state: StatementScanState, token: string) {
  if (state.root === "none") {
    applyStatementRoot(state, token)
    return
  }

  if (consumeStatementContinuation(state, token)) {
    return
  }

  if (state.inQueryBody && QUERY_COMPOUND_KEYWORDS.has(token)) {
    state.inQueryBody = false
    state.continuation = { kind: "query-root" }
    return
  }

  advanceCreateMode(state, token)
}

function shouldKeepStatementContinuation(state: StatementScanState, nextToken: string) {
  const continuation = state.continuation
  if (!continuation) {
    return false
  }

  if (continuation.kind === "with-consumer") {
    return WITH_CONSUMER_KEYWORDS.has(nextToken)
  }

  if (continuation.kind === "insert-source") {
    return nextToken === "default" || nextToken === "with" || nextToken === "select" || nextToken === "values"
  }

  if (continuation.kind === "insert-default-values") {
    return nextToken === "values"
  }

  if (continuation.kind === "query-root" || continuation.kind === "create-as-query") {
    return QUERY_START_KEYWORDS.has(nextToken)
  }

  if (continuation.kind === "explain-statement") {
    return nextToken === "analyze" || SQL_START_KEYWORDS.has(nextToken)
  }

  return false
}

function shouldConsumeNestedQueryStart(state: StatementScanState) {
  return state.continuation?.kind === "query-root" || state.continuation?.kind === "create-as-query"
}

function readWordToken(text: string, start: number) {
  const first = text[start]
  if (!first || !/[A-Za-z_]/.test(first)) {
    return undefined
  }

  let end = start + 1
  while (end < text.length && /[A-Za-z0-9_$]/.test(text[end]!)) {
    end += 1
  }

  return {
    token: text.slice(start, end).toLowerCase(),
    end,
  }
}

function findLikelyKeywordAfterNewline(text: string, start: number, end: number) {
  let i = start

  for (;;) {
    const lineStart = i
    while (i < end && text[i] !== "\n" && text[i] !== " " && text[i] !== "\t" && text[i] !== "\r") {
      i += 1
    }

    let tokenStart = lineStart
    while (tokenStart < end && (text[tokenStart] === " " || text[tokenStart] === "\t" || text[tokenStart] === "\r")) {
      tokenStart += 1
    }
    if (tokenStart >= end) {
      return undefined
    }
    if (text[tokenStart] === "\n") {
      i = tokenStart + 1
      continue
    }

    const lineBreak = text.indexOf("\n", tokenStart)
    const lineEnd = lineBreak === -1 || lineBreak > end ? end : lineBreak
    const line = text.slice(tokenStart, lineEnd).trim()
    if (!line) {
      if (lineBreak === -1 || lineBreak >= end) {
        return undefined
      }
      i = lineBreak + 1
      continue
    }
    if (isGoBatchLine(line) || line.startsWith("--")) {
      if (lineBreak === -1 || lineBreak >= end) {
        return undefined
      }
      i = lineBreak + 1
      continue
    }
    if (tokenStart !== lineStart) {
      return undefined
    }

    const tokenMatch = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(text.slice(tokenStart, end))
    if (!tokenMatch) {
      return undefined
    }

    const token = tokenMatch[0]?.toLowerCase()
    if (!token || !SQL_START_KEYWORDS.has(token)) {
      return undefined
    }

    return {
      gapStart: start,
      nextStart: tokenStart,
      token,
    }
  }
}

function findStandaloneGoLineEnd(text: string, start: number, end: number) {
  if (start > 0 && text[start - 1] !== "\n") {
    return undefined
  }

  let lineEnd = start
  while (lineEnd < end && text[lineEnd] !== "\n") {
    lineEnd += 1
  }

  if (!isGoBatchLine(text.slice(start, lineEnd).trim())) {
    return undefined
  }

  if (lineEnd >= end) {
    return lineEnd
  }

  return lineEnd + 1
}

function collectStatementSpans(text: string): Span[] {
  const segments: Span[] = []
  const spanEnd = text.length
  let segmentStart = 0
  let state: ParseState = { kind: "normal" }
  let leadingToken = getLeadingToken(text, { start: segmentStart, end: spanEnd })
  let statementState = createStatementScanState()
  let depth = 0

  let i = 0
  while (i < spanEnd) {
    const ch = text[i]
    const next = text[i + 1]

    if (state.kind === "normal") {
      if (depth === 0) {
        const goLineEnd = findStandaloneGoLineEnd(text, i, spanEnd)
        if (goLineEnd !== undefined) {
          const trimmed = trimSpan(text, { start: segmentStart, end: i })
          if (trimmed) {
            segments.push(trimmed)
          }
          segmentStart = goLineEnd
          leadingToken = getLeadingToken(text, { start: segmentStart, end: spanEnd })
          statementState = createStatementScanState()
          i = goLineEnd
          continue
        }
      }

      if (ch === "-" && next === "-") {
        state = { kind: "line-comment" }
        i += 2
        continue
      }
      if (ch === "/" && next === "*") {
        state = { kind: "block-comment" }
        i += 2
        continue
      }
      if (ch === "'" || ((ch === "E" || ch === "e") && next === "'")) {
        state = { kind: "single-quote" }
        i += ch === "'" ? 1 : 2
        continue
      }
      if (ch === '"') {
        state = { kind: "double-quote" }
        i++
        continue
      }
      const tag = startsDollarTag(text, i)
      if (tag) {
        state = { kind: "dollar-quote", tag }
        i += tag.length
        continue
      }
      if (ch === ";") {
        const trimmed = trimSpan(text, { start: segmentStart, end: i + 1 })
        if (trimmed) {
          segments.push(trimmed)
        }
        segmentStart = i + 1
        leadingToken = getLeadingToken(text, { start: segmentStart, end: spanEnd })
        statementState = createStatementScanState()
        depth = 0
        i++
        continue
      }
      if (ch === "(") {
        depth += 1
        i++
        continue
      }
      if (ch === ")") {
        depth = Math.max(0, depth - 1)
        i++
        continue
      }
      const word = readWordToken(text, i)
      if (word) {
        if (depth === 0 || shouldConsumeNestedQueryStart(statementState)) {
          updateStatementScanState(statementState, word.token)
        }
        i = word.end
        continue
      }
      if (ch === "\n" && depth === 0) {
        const next = findLikelyKeywordAfterNewline(text, i + 1, spanEnd)
        const canSplitAtNewline =
          next !== undefined &&
          hasNonWhitespace(text, segmentStart, next.gapStart) &&
          leadingToken !== undefined &&
          leadingToken.tokenStart < next.gapStart &&
          SQL_START_KEYWORDS.has(leadingToken.token) &&
          !shouldKeepStatementContinuation(statementState, next.token)
        if (canSplitAtNewline && next) {
          const trimmed = trimSpan(text, { start: segmentStart, end: next.gapStart })
          if (trimmed) {
            segments.push(trimmed)
          }
          segmentStart = next.nextStart
          leadingToken = getLeadingToken(text, { start: segmentStart, end: spanEnd })
          statementState = createStatementScanState()
          i = next.nextStart
          continue
        }
      }
      i++
      continue
    }

    if (state.kind === "line-comment") {
      if (ch === "\n") {
        state = { kind: "normal" }
      }
      i++
      continue
    }

    if (state.kind === "block-comment") {
      if (ch === "*" && next === "/") {
        state = { kind: "normal" }
        i += 2
        continue
      }
      i++
      continue
    }

    if (state.kind === "single-quote") {
      if (ch === "'" && next === "'") {
        i += 2
        continue
      }
      if (ch === "\\") {
        i += 2
        continue
      }
      if (ch === "'") {
        state = { kind: "normal" }
        i++
        continue
      }
      i++
      continue
    }

    if (state.kind === "double-quote") {
      if (ch === '"' && next === '"') {
        i += 2
        continue
      }
      if (ch === '"') {
        state = { kind: "normal" }
        i++
        continue
      }
      i++
      continue
    }

    if (text.startsWith(state.tag, i)) {
      const tag = state.tag
      state = { kind: "normal" }
      i += tag.length
      continue
    }
    i++
  }

  const tail = trimSpan(text, { start: segmentStart, end: spanEnd })
  if (tail) {
    segments.push(tail)
  }

  return segments
}

function trimSpan(text: string, span: Span): Span | undefined {
  let start = span.start
  let end = span.end

  while (start < end && WHITESPACE_RE.test(text[start]!)) {
    start++
  }
  while (end > start && WHITESPACE_RE.test(text[end - 1]!)) {
    end--
  }
  if (start >= end) {
    return undefined
  }
  return { start, end }
}

function trimExecutablePrefix(text: string, span: Span) {
  let start = span.start

  for (;;) {
    while (start < span.end && WHITESPACE_RE.test(text[start]!)) {
      start += 1
    }
    if (start >= span.end) {
      return start
    }

    const lineBreak = text.indexOf("\n", start)
    const lineEnd = lineBreak === -1 || lineBreak > span.end ? span.end : lineBreak
    const line = text.slice(start, lineEnd).trim()
    if (!line) {
      start = lineBreak === -1 || lineBreak >= span.end ? span.end : lineBreak + 1
      continue
    }
    if (isGoBatchLine(line)) {
      start = lineBreak === -1 || lineBreak >= span.end ? span.end : lineBreak + 1
      continue
    }
    if (line.startsWith("--")) {
      start = lineBreak === -1 || lineBreak >= span.end ? span.end : lineBreak + 1
      continue
    }

    return start
  }
}

function trimExecutableSuffix(text: string, span: Span, start: number) {
  let end = span.end

  for (;;) {
    while (end > start && WHITESPACE_RE.test(text[end - 1]!)) {
      end -= 1
    }
    if (end <= start) {
      return end
    }

    let lineStart = end
    while (lineStart > start && text[lineStart - 1] !== "\n") {
      lineStart -= 1
    }

    const line = text.slice(lineStart, end).trim()
    if (!line) {
      end = lineStart
      continue
    }
    if (isGoBatchLine(line)) {
      end = lineStart
      continue
    }
    if (line.startsWith("--")) {
      end = lineStart
      continue
    }

    return end
  }
}

function trimExecutableSpan(text: string, span: Span): Span | undefined {
  const start = trimExecutablePrefix(text, span)
  if (start >= span.end) {
    return undefined
  }

  const end = trimExecutableSuffix(text, span, start)
  if (end <= start) {
    return undefined
  }

  return { start, end }
}

function collectExecutableSpans(text: string) {
  return collectStatementSpans(text)
    .map((span) => trimExecutableSpan(text, span))
    .filter((span): span is Span => !!span)
}

function toSqlStatement(span: Span, lineStarts: readonly number[]): SqlStatement {
  return {
    start: docCharOffset(span.start),
    end: docCharOffset(span.end),
    startLine: lineIndex(offsetToLine(span.start, lineStarts)),
    endLine: lineIndex(offsetToLine(span.end - 1, lineStarts)),
  }
}

function getCursorLine(text: string, lineStarts: readonly number[], offset: number) {
  if (!text.length) {
    return 0
  }

  const cursor = Math.max(0, Math.min(offset, text.length))
  const probe = cursor === text.length && cursor > 0 ? cursor - 1 : cursor
  return offsetToLine(probe, lineStarts)
}

function findSpanAtOffset(text: string, spans: Span[], offset: number): Span | undefined {
  if (!text.length) {
    return undefined
  }

  const cursor = Math.max(0, Math.min(offset, text.length))
  const directProbe = cursor === text.length ? cursor - 1 : cursor
  const direct = spans.find((span) => span.start <= directProbe && directProbe < span.end)
  if (direct) {
    return direct
  }

  let probe = Math.min(cursor - 1, text.length - 1)
  for (; probe >= 0; probe -= 1) {
    if (/\s/.test(text[probe]!)) {
      continue
    }
    if (text[probe] === ";") {
      return undefined
    }
    break
  }
  if (probe < 0) {
    return undefined
  }

  return spans.find((span) => span.start <= probe && probe < span.end)
}

export function collectSqlQueries(text: string, lineStarts: readonly number[]): SqlStatement[] {
  if (!text.length) {
    return []
  }

  return collectExecutableSpans(text)
    .filter((span) => getLeadingToken(text, span))
    .map((span) => toSqlStatement(span, lineStarts))
}

export function analyzeSqlDocument(text: string, lineStarts: readonly number[]): SqlDocumentAnalysis {
  const queries = collectSqlQueries(text, lineStarts)
  return {
    queries,
    queryIndicesByLine: buildQueryIndicesByLine(queries, lineStarts.length),
  }
}

export function collectSqlStatements(text: string, lineStarts: readonly number[]): SqlStatement[] {
  const result: SqlStatement[] = []

  for (const logical of collectStatementSpans(text)) {
    const leadingToken = getLeadingToken(text, logical)
    if (!leadingToken || !SQL_START_KEYWORDS.has(leadingToken.token)) {
      continue
    }

    result.push({
      start: docCharOffset(logical.start),
      end: docCharOffset(logical.end),
      startLine: lineIndex(offsetToLine(logical.start, lineStarts)),
      endLine: lineIndex(offsetToLine(logical.end - 1, lineStarts)),
    })
  }

  return result
}

export function resolveSqlQueryAtOffset(
  text: string,
  lineStarts: readonly number[],
  offset: number,
): SqlQueryResolution {
  return resolveSqlQueryAtLine(collectSqlQueries(text, lineStarts), getCursorLine(text, lineStarts, offset))
}

export function resolveSqlQueryAtLine(queries: SqlStatement[], line: number): SqlQueryResolution {
  if (!queries.length) {
    return { kind: "none" }
  }

  const lineQueries = queries.filter((query) => query.startLine <= line && line <= query.endLine)
  if (!lineQueries.length) {
    return { kind: "none" }
  }
  if (lineQueries.length > 1) {
    return { kind: "ambiguous", queries: lineQueries }
  }

  return { kind: "query", query: lineQueries[0]! }
}

export function getSqlStatementAtOffset(
  text: string,
  lineStarts: readonly number[],
  offset: number,
): SqlStatement | undefined {
  const span = findSpanAtOffset(text, collectStatementSpans(text), offset)
  if (!span) {
    return undefined
  }

  return toSqlStatement(span, lineStarts)
}
