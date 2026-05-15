import { offsetToLine } from "../../../utils/line-offsets"

export type SqlStatement = {
  start: number
  end: number
  startLine: number
  endLine: number
}

export type SqlQueryResolution =
  | { kind: "query"; query: SqlStatement }
  | { kind: "ambiguous"; queries: SqlStatement[] }
  | { kind: "none" }

export type SqlDocumentAnalysis = {
  queries: SqlStatement[]
  queryStartLineByLine: number[]
}

type Span = { start: number; end: number }

type ParseState =
  | { kind: "normal" }
  | { kind: "line-comment" }
  | { kind: "block-comment" }
  | { kind: "single-quote" }
  | { kind: "double-quote" }
  | { kind: "dollar-quote"; tag: string }

const WHITESPACE_RE = /\s/

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

function buildQueryStartLineByLine(queries: SqlStatement[], lineCount: number) {
  const lines = Array.from({ length: lineCount }, () => -1)

  for (const query of queries) {
    for (let line = query.startLine; line <= query.endLine; line += 1) {
      const current = lines[line]
      if (current === -1) {
        lines[line] = query.startLine
        continue
      }
      if (current === query.startLine) {
        continue
      }
      lines[line] = -2
    }
  }

  return lines
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
    if (/^go$/i.test(line) || line.startsWith("--")) {
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
    }
  }
}

function collectStatementSpans(text: string): Span[] {
  const segments: Span[] = []
  const spanEnd = text.length
  let segmentStart = 0
  let state: ParseState = { kind: "normal" }
  let leadingToken = getLeadingToken(text, { start: segmentStart, end: spanEnd })
  let allowWithContinuation = leadingToken?.token === "with"
  let depth = 0

  let i = 0
  while (i < spanEnd) {
    const ch = text[i]
    const next = text[i + 1]

    if (state.kind === "normal") {
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
        allowWithContinuation = leadingToken?.token === "with"
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
      if (ch === "\n" && depth === 0) {
        const next = findLikelyKeywordAfterNewline(text, i + 1, spanEnd)
        const canSplitAtNewline =
          next !== undefined &&
          hasNonWhitespace(text, segmentStart, next.gapStart) &&
          leadingToken !== undefined &&
          leadingToken.tokenStart < next.gapStart &&
          SQL_START_KEYWORDS.has(leadingToken.token)
        if (canSplitAtNewline && next) {
          if (leadingToken?.token === "with" && allowWithContinuation) {
            allowWithContinuation = false
            i++
            continue
          }
          const trimmed = trimSpan(text, { start: segmentStart, end: next.gapStart })
          if (trimmed) {
            segments.push(trimmed)
          }
          segmentStart = next.nextStart
          leadingToken = getLeadingToken(text, { start: segmentStart, end: spanEnd })
          allowWithContinuation = leadingToken?.token === "with"
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
    if (/^go$/i.test(line)) {
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
    if (/^go$/i.test(line)) {
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

function toSqlStatement(span: Span, lineStarts: number[]): SqlStatement {
  return {
    start: span.start,
    end: span.end,
    startLine: offsetToLine(span.start, lineStarts),
    endLine: offsetToLine(span.end - 1, lineStarts),
  }
}

function getCursorLine(text: string, lineStarts: number[], offset: number) {
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

export function collectSqlQueries(text: string, lineStarts: number[]): SqlStatement[] {
  if (!text.length) {
    return []
  }

  return collectExecutableSpans(text)
    .filter((span) => getLeadingToken(text, span))
    .map((span) => toSqlStatement(span, lineStarts))
}

export function analyzeSqlDocument(text: string, lineStarts: number[]): SqlDocumentAnalysis {
  const queries = collectSqlQueries(text, lineStarts)
  return {
    queries,
    queryStartLineByLine: buildQueryStartLineByLine(queries, lineStarts.length),
  }
}

export function collectSqlStatements(text: string, lineStarts: number[]): SqlStatement[] {
  const result: SqlStatement[] = []

  for (const logical of collectStatementSpans(text)) {
    const leadingToken = getLeadingToken(text, logical)
    if (!leadingToken || !SQL_START_KEYWORDS.has(leadingToken.token)) {
      continue
    }

    result.push({
      start: logical.start,
      end: logical.end,
      startLine: offsetToLine(logical.start, lineStarts),
      endLine: offsetToLine(logical.end - 1, lineStarts),
    })
  }

  return result
}

export function resolveSqlQueryAtOffset(text: string, lineStarts: number[], offset: number): SqlQueryResolution {
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

export function getSqlStatementAtOffset(text: string, lineStarts: number[], offset: number): SqlStatement | undefined {
  const span = findSpanAtOffset(text, collectStatementSpans(text), offset)
  if (!span) {
    return undefined
  }

  return toSqlStatement(span, lineStarts)
}
