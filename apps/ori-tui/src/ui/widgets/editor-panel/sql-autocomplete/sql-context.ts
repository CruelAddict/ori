import { buildLineStarts } from "../../../../utils/line-offsets"
import { collectSqlStatements, getSqlStatementAtOffset } from "../sql-statement-detector"
import type { SqlDialect } from "./dialect"

/* 100% LLM-generated, use tests as source of truth for expected behavior */

export type SqlClause =
  | "select"
  | "from"
  | "join"
  | "where"
  | "group"
  | "order"
  | "having"
  | "limit"
  | "offset"
  | "set"
  | "on"
  | "into"
  | "unknown"

export type SqlStatementSlice = {
  text: string
  start: number
  end: number
  cursorOffset: number
}

export type SqlCompletionSpan = {
  replaceStart: number
  replaceEnd: number
  token: string
  scopeName?: string
  mode: "word" | "member"
}

export type SqlTableRef = {
  name: string
  database?: string
  schema?: string
  alias?: string
}

export type SqlNamedQuery = {
  name: string
  query: string
  queryStart: number
  queryEnd: number
  columns: string[]
  recursive: boolean
}

export type SqlDerivedTable = {
  alias: string
  query: string
  columns: string[]
}

export type SqlInsertContext = {
  target: SqlTableRef
  mode: "keywords" | "columns"
  usedColumns: string[]
}

const IDENTIFIER = '(?:"(?:[^"]|"")+"|\\[[^\\]]+\\]|`[^`]+`|[A-Za-z_][A-Za-z0-9_$]*)'
const PARTIAL_IDENTIFIER = '(?:"(?:[^"]|"")*"?|\\[[^\\]]*\\]?|`[^`]*`?|[A-Za-z_][A-Za-z0-9_$]*)'
const IDENTIFIER_START = new RegExp(`^${IDENTIFIER}`)
const RESERVED_WORDS = new Set([
  "select",
  "from",
  "where",
  "join",
  "left",
  "right",
  "inner",
  "outer",
  "full",
  "cross",
  "group",
  "order",
  "by",
  "set",
  "on",
  "limit",
  "offset",
  "values",
  "returning",
  "union",
])

type ParseState = "normal" | "line-comment" | "block-comment" | "single-quote" | "double-quote" | "dollar-quote"

function startsDollarTag(text: string, index: number): string | undefined {
  if (text[index] !== "$") {
    return undefined
  }

  let i = index + 1
  while (i < text.length && /[A-Za-z0-9_]/.test(text[i] ?? "")) {
    i += 1
  }
  if (text[i] !== "$") {
    return undefined
  }
  return text.slice(index, i + 1)
}

function scanState(text: string) {
  let state: ParseState = "normal"
  let tag = ""

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] ?? ""
    const next = text[i + 1] ?? ""

    if (state === "normal") {
      if (ch === "-" && next === "-") {
        state = "line-comment"
        i += 1
        continue
      }
      if (ch === "/" && next === "*") {
        state = "block-comment"
        i += 1
        continue
      }
      if (ch === "'") {
        state = "single-quote"
        continue
      }
      if (ch === '"') {
        state = "double-quote"
        continue
      }

      const nextTag = startsDollarTag(text, i)
      if (!nextTag) {
        continue
      }
      state = "dollar-quote"
      tag = nextTag
      i += nextTag.length - 1
      continue
    }

    if (state === "line-comment") {
      if (ch === "\n") {
        state = "normal"
      }
      continue
    }

    if (state === "block-comment") {
      if (ch === "*" && next === "/") {
        state = "normal"
        i += 1
      }
      continue
    }

    if (state === "single-quote") {
      if (ch === "'" && next === "'") {
        i += 1
        continue
      }
      if (ch === "'") {
        state = "normal"
      }
      continue
    }

    if (state === "double-quote") {
      if (ch === '"' && next === '"') {
        i += 1
        continue
      }
      if (ch === '"') {
        state = "normal"
      }
      continue
    }

    if (!text.startsWith(tag, i)) {
      continue
    }
    state = "normal"
    i += tag.length - 1
    tag = ""
  }

  return state
}

export function maskSql(text: string, keepDoubleQuotes = false) {
  let masked = ""
  let state: ParseState = "normal"
  let tag = ""

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] ?? ""
    const next = text[i + 1] ?? ""

    if (state === "normal") {
      if (ch === "-" && next === "-") {
        state = "line-comment"
        masked += "  "
        i += 1
        continue
      }
      if (ch === "/" && next === "*") {
        state = "block-comment"
        masked += "  "
        i += 1
        continue
      }
      if (ch === "'") {
        state = "single-quote"
        masked += " "
        continue
      }
      if (ch === '"') {
        state = "double-quote"
        masked += keepDoubleQuotes ? ch : " "
        continue
      }

      const nextTag = startsDollarTag(text, i)
      if (!nextTag) {
        masked += ch
        continue
      }
      state = "dollar-quote"
      tag = nextTag
      masked += " ".repeat(nextTag.length)
      i += nextTag.length - 1
      continue
    }

    if (state === "line-comment") {
      if (ch === "\n") {
        state = "normal"
        masked += "\n"
        continue
      }
      masked += " "
      continue
    }

    if (state === "block-comment") {
      if (ch === "*" && next === "/") {
        state = "normal"
        masked += "  "
        i += 1
        continue
      }
      masked += ch === "\n" ? "\n" : " "
      continue
    }

    if (state === "single-quote") {
      if (ch === "'" && next === "'") {
        masked += "  "
        i += 1
        continue
      }
      if (ch === "'") {
        state = "normal"
        masked += " "
        continue
      }
      masked += ch === "\n" ? "\n" : " "
      continue
    }

    if (state === "double-quote") {
      if (ch === '"' && next === '"') {
        masked += keepDoubleQuotes ? '""' : "  "
        i += 1
        continue
      }
      if (ch === '"') {
        state = "normal"
        masked += keepDoubleQuotes ? ch : " "
        continue
      }
      masked += keepDoubleQuotes ? ch : ch === "\n" ? "\n" : " "
      continue
    }

    if (!text.startsWith(tag, i)) {
      masked += ch === "\n" ? "\n" : " "
      continue
    }
    state = "normal"
    masked += " ".repeat(tag.length)
    i += tag.length - 1
    tag = ""
  }

  return masked
}

export function getCurrentSqlStatement(text: string, cursorOffset: number): SqlStatementSlice | undefined {
  const lineStarts = buildLineStarts(text)
  const statement = getSqlStatementAtOffset(text, lineStarts, cursorOffset)
  if (!statement) {
    return undefined
  }

  const end = Math.max(statement.end, cursorOffset)

  return {
    text: text.slice(statement.start, end),
    start: statement.start,
    end,
    cursorOffset: cursorOffset - statement.start,
  }
}

export function getTempTableNames(text: string, cursorOffset: number, dialect: SqlDialect) {
  const lineStarts = buildLineStarts(text)
  const current = getSqlStatementAtOffset(text, lineStarts, cursorOffset)
  const boundary = current?.start ?? cursorOffset
  const names: string[] = []

  for (const statement of collectSqlStatements(text, lineStarts)) {
    if (statement.end > boundary) {
      continue
    }
    const match = text.slice(statement.start, statement.end).match(dialect.tempTablePattern)
    if (!match?.[1]) {
      continue
    }

    const normalized = normalizeIdentifier(match[1].split(".").at(-1))
    if (!normalized) {
      continue
    }
    if (names.includes(normalized)) {
      continue
    }
    names.push(normalized)
  }

  return names
}

export function isInsideSuppressedRegion(text: string, cursorOffset: number) {
  const state = scanState(text.slice(0, cursorOffset))
  return state !== "normal" && state !== "double-quote"
}

export function normalizeIdentifier(value: string | undefined) {
  if (!value) {
    return undefined
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replaceAll('""', '"')
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    return value.slice(1, -1)
  }
  if (value.startsWith("`") && value.endsWith("`")) {
    return value.slice(1, -1)
  }
  return value
}

function normalizeIdentifierPrefix(value: string | undefined) {
  if (!value) {
    return ""
  }

  const normalized = normalizeIdentifier(value)
  if (normalized && normalized !== value) {
    return normalized
  }
  if (value.startsWith('"')) {
    return value.slice(1).replaceAll('""', '"')
  }
  if (value.startsWith("[")) {
    return value.slice(1)
  }
  if (value.startsWith("`")) {
    return value.slice(1)
  }
  return value
}

function skipWhitespace(text: string, index: number) {
  let i = index
  while (i < text.length && /\s/.test(text[i] ?? "")) {
    i += 1
  }
  return i
}

function readIdentifier(text: string, index: number) {
  const value = text.slice(index).match(IDENTIFIER_START)?.[0]
  if (!value) {
    return undefined
  }

  return {
    value,
    end: index + value.length,
  }
}

function findMatchingParen(text: string, openIndex: number) {
  if (text[openIndex] !== "(") {
    return undefined
  }

  let depth = 0
  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === "(") {
      depth += 1
      continue
    }
    if (ch !== ")") {
      continue
    }
    depth -= 1
    if (depth === 0) {
      return i
    }
  }
}

function maskNestedContents(text: string, keepDoubleQuotes = false) {
  const masked = maskSql(text, keepDoubleQuotes)
  let next = ""
  let depth = 0

  for (const ch of masked) {
    if (ch === "(") {
      depth += 1
      next += ch
      continue
    }
    if (ch === ")") {
      depth = Math.max(0, depth - 1)
      next += ch
      continue
    }
    if (depth === 0) {
      next += ch
      continue
    }
    next += ch === "\n" ? "\n" : " "
  }

  return next
}

export function findCurrentClause(text: string, cursorOffset: number): SqlClause {
  const masked = maskSql(text.slice(0, cursorOffset))
  const clauses: SqlClause[] = ["unknown"]
  const previous: Array<string | undefined> = [undefined]
  let token = ""
  let depth = 0

  const push = () => {
    if (!token) {
      return
    }

    const current = token.toLowerCase()
    const prev = previous[depth]

    if (current === "select") {
      clauses[depth] = "select"
    }
    if (current === "from") {
      clauses[depth] = "from"
    }
    if (current === "where") {
      clauses[depth] = "where"
    }
    if (current === "having") {
      clauses[depth] = "having"
    }
    if (current === "limit") {
      clauses[depth] = "limit"
    }
    if (current === "offset") {
      clauses[depth] = "offset"
    }
    if (current === "set") {
      clauses[depth] = "set"
    }
    if (current === "on") {
      clauses[depth] = "on"
    }
    if (current === "into" && prev === "insert") {
      clauses[depth] = "into"
    }
    if (current === "update") {
      clauses[depth] = "into"
    }
    if (current === "by" && prev === "group") {
      clauses[depth] = "group"
    }
    if (current === "by" && prev === "order") {
      clauses[depth] = "order"
    }
    if (current === "join") {
      clauses[depth] = "join"
    }

    previous[depth] = current
    token = ""
  }

  for (const ch of masked) {
    if (ch === "(") {
      push()
      depth += 1
      clauses[depth] = clauses[depth - 1] ?? "unknown"
      previous[depth] = undefined
      continue
    }
    if (ch === ")") {
      push()
      previous[depth] = undefined
      depth = Math.max(0, depth - 1)
      continue
    }
    if (/[A-Za-z_]/.test(ch) || (token && /[A-Za-z0-9_$]/.test(ch))) {
      token += ch
      continue
    }
    push()
  }

  push()
  return clauses[depth] ?? "unknown"
}

export function extractTableRefs(text: string): SqlTableRef[] {
  const refs: SqlTableRef[] = []
  const masked = maskNestedContents(text, true)

  let i = 0
  let prev = ""
  let clause: "" | "from" | "join" | "update" | "into" = ""
  let expectRef = false

  const parseRef = (index: number) => {
    const first = readIdentifier(text, index)
    if (!first) {
      return undefined
    }

    let end = first.end
    const parts = [first.value]

    for (;;) {
      const dot = skipWhitespace(masked, end)
      if (masked[dot] !== ".") {
        break
      }
      const next = readIdentifier(text, skipWhitespace(masked, dot + 1))
      if (!next) {
        break
      }
      parts.push(next.value)
      end = next.end
      if (parts.length === 3) {
        break
      }
    }

    const aliasStart = skipWhitespace(masked, end)
    const asMatch = masked.slice(aliasStart).match(/^as\b/i)?.[0]
    const aliasToken = readIdentifier(text, skipWhitespace(masked, aliasStart + (asMatch?.length ?? 0)))
    const alias = normalizeIdentifier(aliasToken?.value)
    if (alias && !RESERVED_WORDS.has(alias.toLowerCase())) {
      end = aliasToken!.end
    }

    const names = parts.map((part) => normalizeIdentifier(part))
    const name = names.at(-1)
    if (!name) {
      return undefined
    }

    const database = names.length === 3 ? names[0] : undefined
    const schema = names.length >= 2 ? names[names.length - 2] : undefined
    return {
      end,
      ref: {
        name,
        database,
        schema,
        alias: alias && !RESERVED_WORDS.has(alias.toLowerCase()) ? alias : undefined,
      },
    }
  }

  const readWord = (index: number) => {
    const match = masked.slice(index).match(/^[A-Za-z_][A-Za-z0-9_$]*/)?.[0]
    if (!match) {
      return undefined
    }
    return {
      value: match.toLowerCase(),
      end: index + match.length,
    }
  }

  for (; i < masked.length; ) {
    i = skipWhitespace(masked, i)
    if (i >= masked.length) {
      break
    }

    if (expectRef) {
      const parsed = parseRef(i)
      if (parsed) {
        refs.push(parsed.ref)
        i = parsed.end
        expectRef = false
        continue
      }
      expectRef = false
    }

    if (clause === "from" && masked[i] === ",") {
      expectRef = true
      i += 1
      continue
    }

    const word = readWord(i)
    if (!word) {
      i += 1
      continue
    }

    i = word.end
    if (word.value === "insert") {
      prev = word.value
      continue
    }

    if (word.value === "from") {
      clause = "from"
      expectRef = true
      prev = word.value
      continue
    }

    if (word.value === "join") {
      clause = "join"
      expectRef = true
      prev = word.value
      continue
    }

    if (word.value === "update") {
      clause = "update"
      expectRef = true
      prev = word.value
      continue
    }

    if (word.value === "into" && prev === "insert") {
      clause = "into"
      expectRef = true
      prev = word.value
      continue
    }

    if (
      ["where", "group", "order", "having", "limit", "offset", "union", "set", "returning", "values"].includes(
        word.value,
      )
    ) {
      clause = ""
      prev = word.value
      continue
    }

    prev = word.value
  }

  return refs
}

export function buildAliasMap(refs: SqlTableRef[]) {
  const aliases = new Map<string, SqlTableRef>()
  for (const ref of refs) {
    if (!ref.alias) {
      continue
    }
    aliases.set(ref.alias.toLowerCase(), ref)
  }
  return aliases
}

export function extractCteQueries(text: string): SqlNamedQuery[] {
  const masked = maskSql(text, true)
  const withIndex = skipWhitespace(masked, 0)
  const withMatch = masked.slice(withIndex).match(/^with\b/i)?.[0]
  if (!withMatch) {
    return []
  }

  const queries: SqlNamedQuery[] = []
  let index = skipWhitespace(masked, withIndex + withMatch.length)
  const recursiveMatch = masked.slice(index).match(/^recursive\b/i)
  const recursive = Boolean(recursiveMatch?.[0])
  if (recursiveMatch?.[0]) {
    index = skipWhitespace(masked, index + recursiveMatch[0].length)
  }

  while (index < masked.length) {
    const identifier = readIdentifier(text, index)
    const name = normalizeIdentifier(identifier?.value)
    if (!identifier || !name) {
      return queries
    }

    index = skipWhitespace(masked, identifier.end)
    const columns: string[] = []
    if (masked[index] === "(") {
      const columnsEnd = findMatchingParen(masked, index)
      if (columnsEnd === undefined) {
        return queries
      }
      for (const rawColumn of text.slice(index + 1, columnsEnd).split(",")) {
        const column = normalizeIdentifier(rawColumn.trim())
        if (!column) {
          continue
        }
        columns.push(column)
      }
      index = skipWhitespace(masked, columnsEnd + 1)
    }

    const asMatch = masked.slice(index).match(/^as\b/i)
    if (!asMatch?.[0]) {
      return queries
    }

    index = skipWhitespace(masked, index + asMatch[0].length)
    const materializedMatch = masked.slice(index).match(/^(?:not\s+)?materialized\b/i)?.[0]
    if (materializedMatch) {
      index = skipWhitespace(masked, index + materializedMatch.length)
    }
    if (masked[index] !== "(") {
      return queries
    }

    const queryEnd = findMatchingParen(masked, index)
    if (queryEnd === undefined) {
      return queries
    }

    queries.push({
      name,
      query: text.slice(index + 1, queryEnd),
      queryStart: index + 1,
      queryEnd,
      columns,
      recursive,
    })

    index = skipWhitespace(masked, queryEnd + 1)
    if (masked[index] !== ",") {
      return queries
    }
    index = skipWhitespace(masked, index + 1)
  }

  return queries
}

export function extractCteNames(text: string) {
  return extractCteQueries(text).map((item) => item.name)
}

export function extractDerivedTables(text: string): SqlDerivedTable[] {
  const masked = maskNestedContents(text, true)
  const derived: SqlDerivedTable[] = []
  const pattern = /\b(?:from|join)\b\s*\(/gi

  for (const match of masked.matchAll(pattern)) {
    const openIndex = match.index + match[0].length - 1
    const closeIndex = findMatchingParen(masked, openIndex)
    if (closeIndex === undefined) {
      continue
    }

    let aliasIndex = skipWhitespace(masked, closeIndex + 1)
    const asMatch = masked.slice(aliasIndex).match(/^as\b/i)
    if (asMatch?.[0]) {
      aliasIndex = skipWhitespace(masked, aliasIndex + asMatch[0].length)
    }

    const aliasToken = readIdentifier(text, aliasIndex)
    const alias = normalizeIdentifier(aliasToken?.value)
    if (!alias || !aliasToken) {
      continue
    }

    const columnsIndex = skipWhitespace(masked, aliasToken.end)
    const columns: string[] = []
    if (masked[columnsIndex] === "(") {
      const columnsEnd = findMatchingParen(masked, columnsIndex)
      if (columnsEnd !== undefined) {
        for (const rawColumn of text.slice(columnsIndex + 1, columnsEnd).split(",")) {
          const column = normalizeIdentifier(rawColumn.trim())
          if (!column) {
            continue
          }
          columns.push(column)
        }
      }
    }

    derived.push({
      alias,
      query: text.slice(openIndex + 1, closeIndex),
      columns,
    })
  }

  return derived
}

export function getInsertContext(text: string, cursorOffset: number): SqlInsertContext | undefined {
  const beforeCursor = maskSql(text.slice(0, cursorOffset), true)
  const keywordMatch = beforeCursor.match(
    new RegExp(
      `\\binsert\\s+into\\s+(?:(${IDENTIFIER})\\s*\\.\\s*)?(?:(${IDENTIFIER})\\s*\\.\\s*)?(${IDENTIFIER})\\s+([A-Za-z_]*)$`,
      "i",
    ),
  )
  if (keywordMatch?.[3]) {
    return {
      target: {
        database: keywordMatch[2] ? normalizeIdentifier(keywordMatch[1]) : undefined,
        schema: normalizeIdentifier(keywordMatch[2] ?? keywordMatch[1]),
        name: normalizeIdentifier(keywordMatch[3])!,
      },
      mode: "keywords",
      usedColumns: [],
    }
  }

  const columnMatch = beforeCursor.match(
    new RegExp(
      `\\binsert\\s+into\\s+(?:(${IDENTIFIER})\\s*\\.\\s*)?(?:(${IDENTIFIER})\\s*\\.\\s*)?(${IDENTIFIER})\\s*\\(([^()]*)$`,
      "i",
    ),
  )
  if (!columnMatch?.[3]) {
    return undefined
  }

  const segments = columnMatch[4].split(",")
  const usedColumns = segments
    .slice(0, Math.max(0, segments.length - 1))
    .map((segment) => normalizeIdentifier(segment.trim()))
    .filter((segment): segment is string => Boolean(segment))

  return {
    target: {
      database: columnMatch[2] ? normalizeIdentifier(columnMatch[1]) : undefined,
      schema: normalizeIdentifier(columnMatch[2] ?? columnMatch[1]),
      name: normalizeIdentifier(columnMatch[3])!,
    },
    mode: "columns",
    usedColumns,
  }
}

export function findCompletionSpan(text: string, cursorOffset: number, statementStart = 0): SqlCompletionSpan {
  const beforeCursor = text.slice(0, cursorOffset)
  const memberMatch = beforeCursor.match(new RegExp(`(${IDENTIFIER})\\s*\\.\\s*(${PARTIAL_IDENTIFIER})?$`))
  if (memberMatch) {
    const rawToken = memberMatch[2] ?? ""
    return {
      replaceStart: statementStart + cursorOffset - rawToken.length,
      replaceEnd: statementStart + cursorOffset,
      token: normalizeIdentifierPrefix(rawToken),
      scopeName: normalizeIdentifier(memberMatch[1]),
      mode: "member",
    }
  }

  const quotedWordMatch = beforeCursor.match(new RegExp(`(${PARTIAL_IDENTIFIER})$`))
  const rawQuotedToken = quotedWordMatch?.[1] ?? ""
  if (rawQuotedToken.startsWith('"') || rawQuotedToken.startsWith("[") || rawQuotedToken.startsWith("`")) {
    return {
      replaceStart: statementStart + cursorOffset - rawQuotedToken.length,
      replaceEnd: statementStart + cursorOffset,
      token: normalizeIdentifierPrefix(rawQuotedToken),
      mode: "word",
    }
  }

  const wordMatch = beforeCursor.match(/[A-Za-z_][A-Za-z0-9_$]*$/)
  const token = wordMatch?.[0] ?? ""
  return {
    replaceStart: statementStart + cursorOffset - token.length,
    replaceEnd: statementStart + cursorOffset,
    token,
    mode: "word",
  }
}
