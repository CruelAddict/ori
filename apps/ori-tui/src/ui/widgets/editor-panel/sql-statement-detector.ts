import { type DocCharOffset, docCharOffset, type LineIndex, lineIndex } from "@ui/components/buffer/coords"
import { type SqlToken, scanSql } from "@utils/sql-scanner"
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
type LeadingToken = { tokenStart: number; token?: string }
type StatementSpan = { logical: Span; leading?: LeadingToken }
type NextStatement = { nextStart: number; token: string }

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

function getLeadingToken(token: SqlToken): LeadingToken {
  if (token.kind === "word" && token.value) {
    return { tokenStart: token.start, token: token.value }
  }
  return { tokenStart: token.start }
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

function buildNextStatements(text: string, lineStarts: readonly number[], tokens: readonly SqlToken[]) {
  const firstTokens: (SqlToken | undefined)[] = []
  let line = 0
  for (const token of tokens) {
    while (line + 1 < lineStarts.length && token.start >= (lineStarts[line + 1] ?? Number.POSITIVE_INFINITY)) {
      line += 1
    }
    if (token.kind !== "newline" && firstTokens[line] === undefined) {
      firstTokens[line] = token
    }
  }

  const nextByLine: (NextStatement | undefined)[] = []
  const goTokenStarts = new Set<number>()
  let next: NextStatement | undefined
  for (let index = lineStarts.length - 1; index >= 0; index -= 1) {
    const start = lineStarts[index] ?? 0
    const end = index + 1 < lineStarts.length ? (lineStarts[index + 1] ?? text.length) - 1 : text.length
    let first = start
    while (first < end && WHITESPACE_RE.test(text[first]!)) {
      first += 1
    }
    const firstToken = firstTokens[index]
    const token = first === start && firstToken?.start === start ? firstToken : undefined
    const isGoLine = isStandaloneGoToken(text, firstToken, start, end)
    if (isGoLine && firstToken) {
      goTokenStarts.add(firstToken.start)
    }

    if (first === end || (text[first] === "-" && text[first + 1] === "-") || isGoLine) {
      nextByLine[index] = next
      continue
    }

    next =
      token?.kind === "word" && token.depth === 0 && token.value && SQL_START_KEYWORDS.has(token.value)
        ? { nextStart: start, token: token.value }
        : undefined
    nextByLine[index] = next
  }

  return { goTokenStarts, nextByLine }
}

function isStandaloneGoToken(text: string, token: SqlToken | undefined, lineStart: number, lineEnd: number) {
  if (token?.kind !== "word" || token.depth !== 0 || token.value !== "go") {
    return false
  }
  for (let index = lineStart; index < token.start; index += 1) {
    if (!WHITESPACE_RE.test(text[index]!)) {
      return false
    }
  }
  let index = token.end
  while (index < lineEnd && WHITESPACE_RE.test(text[index]!)) {
    index += 1
  }
  return index === lineEnd || (text[index] === "-" && text[index + 1] === "-")
}

function collectStatementSpans(
  text: string,
  lineStarts: readonly number[],
  tokens: readonly SqlToken[],
): StatementSpan[] {
  const segments: StatementSpan[] = []
  const { goTokenStarts, nextByLine } = buildNextStatements(text, lineStarts, tokens)
  let segmentStart = 0
  let leadingToken: LeadingToken | undefined
  let statementState = createStatementScanState()
  let line = 0

  const push = (end: number) => {
    const logical = trimSpan(text, { start: segmentStart, end })
    if (logical) {
      segments.push({ logical, leading: leadingToken })
    }
  }

  for (const token of tokens) {
    while (line + 1 < lineStarts.length && token.start >= (lineStarts[line + 1] ?? Number.POSITIVE_INFINITY)) {
      line += 1
    }
    const lineStart = lineStarts[line] ?? 0
    if (goTokenStarts.has(token.start)) {
      push(lineStart)
      const goLineEnd = line + 1 < lineStarts.length ? (lineStarts[line + 1] ?? text.length) : text.length
      segmentStart = goLineEnd
      leadingToken = undefined
      statementState = createStatementScanState()
      continue
    }

    if (token.kind === "semicolon") {
      push(token.end)
      segmentStart = token.end
      leadingToken = undefined
      statementState = createStatementScanState()
      continue
    }

    if (token.kind !== "newline" && leadingToken === undefined) {
      leadingToken = getLeadingToken(token)
    }

    if (token.kind === "word" && token.value) {
      if (token.depth === 0 || shouldConsumeNestedQueryStart(statementState)) {
        updateStatementScanState(statementState, token.value)
      }
      continue
    }

    if (token.kind !== "newline" || token.depth !== 0) {
      continue
    }

    const next = nextByLine[line + 1]
    const canSplitAtNewline =
      next !== undefined &&
      leadingToken?.token !== undefined &&
      leadingToken.tokenStart < token.end &&
      SQL_START_KEYWORDS.has(leadingToken.token) &&
      !shouldKeepStatementContinuation(statementState, next.token)
    if (!canSplitAtNewline || !next) {
      continue
    }
    push(token.end)
    segmentStart = next.nextStart
    leadingToken = undefined
    statementState = createStatementScanState()
  }

  push(text.length)
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

function collectExecutableSpans(text: string, spans: readonly StatementSpan[]) {
  return spans.flatMap(({ logical, leading }) => {
    const executable = trimExecutableSpan(text, logical)
    return executable ? [{ executable, leading }] : []
  })
}

function toSqlStatement(span: Span, lineStarts: readonly number[]): SqlStatement {
  return {
    start: docCharOffset(span.start),
    end: docCharOffset(span.end),
    startLine: lineIndex(offsetToLine(span.start, lineStarts)),
    endLine: lineIndex(offsetToLine(span.end - 1, lineStarts)),
  }
}

function toSqlStatements(spans: readonly Span[], lineStarts: readonly number[]): SqlStatement[] {
  let startLine = 0
  let endLine = 0
  return spans.map((span) => {
    while (startLine + 1 < lineStarts.length && span.start >= (lineStarts[startLine + 1] ?? Number.POSITIVE_INFINITY)) {
      startLine += 1
    }
    while (endLine + 1 < lineStarts.length && span.end - 1 >= (lineStarts[endLine + 1] ?? Number.POSITIVE_INFINITY)) {
      endLine += 1
    }
    return {
      start: docCharOffset(span.start),
      end: docCharOffset(span.end),
      startLine: lineIndex(startLine),
      endLine: lineIndex(endLine),
    }
  })
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

  const tokens = scanSql(text).tokens
  const spans = collectStatementSpans(text, lineStarts, tokens)
  return toSqlStatements(
    collectExecutableSpans(text, spans)
      .filter((span) => span.leading?.token !== undefined)
      .map((span) => span.executable),
    lineStarts,
  )
}

export function analyzeSqlDocument(text: string, lineStarts: readonly number[]): SqlDocumentAnalysis {
  const queries = collectSqlQueries(text, lineStarts)
  return {
    queries,
    queryIndicesByLine: buildQueryIndicesByLine(queries, lineStarts.length),
  }
}

export function collectSqlStatements(text: string, lineStarts: readonly number[]): SqlStatement[] {
  const tokens = scanSql(text).tokens
  return toSqlStatements(
    collectStatementSpans(text, lineStarts, tokens)
      .filter((span) => span.leading?.token !== undefined && SQL_START_KEYWORDS.has(span.leading.token))
      .map((span) => span.logical),
    lineStarts,
  )
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
  const tokens = scanSql(text).tokens
  const span = findSpanAtOffset(
    text,
    collectStatementSpans(text, lineStarts, tokens).map((statement) => statement.logical),
    offset,
  )
  if (!span) {
    return undefined
  }

  return toSqlStatement(span, lineStarts)
}
