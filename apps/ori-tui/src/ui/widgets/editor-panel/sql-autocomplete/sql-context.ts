import { buildLineStarts } from "@utils/line-offsets"
import { collectSqlStatements, getSqlStatementAtOffset } from "../sql-statement-detector"
import type { SqlDialect } from "./dialect"

/* LLM-generated, use tests as source of truth for expected behavior */

export type SqlClause =
  | "select"
  | "from"
  | "join"
  | "where"
  | "group"
  | "order"
  | "having"
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
  schema?: string
  alias?: string
}

export type SqlInsertContext = {
  target: SqlTableRef
  mode: "keywords" | "columns"
  usedColumns: string[]
}

const IDENTIFIER = '(?:"(?:[^"]|"")+"|\\[[^\\]]+\\]|`[^`]+`|[A-Za-z_][A-Za-z0-9_$]*)'
const TABLE_REF_PATTERN = new RegExp(
  `(?:\\bFROM\\b|\\bJOIN\\b|\\bUPDATE\\b|\\bINTO\\b)\\s+(?:(${IDENTIFIER})\\s*\\.\\s*)?(${IDENTIFIER})(?:\\s+(?:AS\\s+)?([A-Za-z_][A-Za-z0-9_$]*))?`,
  "gi",
)
const CTE_NAME_PATTERN = /([A-Za-z_][A-Za-z0-9_$]*)\s+AS\s*\(/gi
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

function maskSql(text: string) {
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
        masked += " "
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
        masked += "  "
        i += 1
        continue
      }
      if (ch === '"') {
        state = "normal"
        masked += " "
        continue
      }
      masked += ch === "\n" ? "\n" : " "
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
  const masked = maskSql(text)

  for (const match of masked.matchAll(TABLE_REF_PATTERN)) {
    const schema = normalizeIdentifier(match[1])
    const name = normalizeIdentifier(match[2])
    const alias = match[3]
    if (!name) {
      continue
    }
    if (alias && RESERVED_WORDS.has(alias.toLowerCase())) {
      refs.push({ name, schema })
      continue
    }
    refs.push({ name, schema, alias })
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

export function extractCteNames(text: string) {
  const masked = maskSql(text)
  const withIndex = masked.search(/\bwith\b/i)
  if (withIndex === -1) {
    return []
  }

  const names: string[] = []
  let depth = 0
  let segment = ""

  for (const ch of masked.slice(withIndex + 4)) {
    if (ch === "(") {
      depth += 1
    }
    if (ch === ")") {
      depth = Math.max(0, depth - 1)
    }
    if (depth === 0 && /\bselect\b/i.test(segment.slice(-8) + ch)) {
      break
    }
    segment += ch
  }

  for (const match of segment.matchAll(CTE_NAME_PATTERN)) {
    const name = match[1]
    if (!name) {
      continue
    }
    names.push(name)
  }

  return names
}

export function getInsertContext(text: string, cursorOffset: number): SqlInsertContext | undefined {
  const beforeCursor = maskSql(text.slice(0, cursorOffset))
  const keywordMatch = beforeCursor.match(
    new RegExp(`\\binsert\\s+into\\s+(?:(${IDENTIFIER})\\s*\\.\\s*)?(${IDENTIFIER})\\s+([A-Za-z_]*)$`, "i"),
  )
  if (keywordMatch?.[2]) {
    return {
      target: {
        schema: normalizeIdentifier(keywordMatch[1]),
        name: normalizeIdentifier(keywordMatch[2])!,
      },
      mode: "keywords",
      usedColumns: [],
    }
  }

  const columnMatch = beforeCursor.match(
    new RegExp(`\\binsert\\s+into\\s+(?:(${IDENTIFIER})\\s*\\.\\s*)?(${IDENTIFIER})\\s*\\(([^()]*)$`, "i"),
  )
  if (!columnMatch?.[2]) {
    return undefined
  }

  const segments = columnMatch[3].split(",")
  const usedColumns = segments
    .slice(0, Math.max(0, segments.length - 1))
    .map((segment) => normalizeIdentifier(segment.trim()))
    .filter((segment): segment is string => Boolean(segment))

  return {
    target: {
      schema: normalizeIdentifier(columnMatch[1]),
      name: normalizeIdentifier(columnMatch[2])!,
    },
    mode: "columns",
    usedColumns,
  }
}

export function findCompletionSpan(text: string, cursorOffset: number, statementStart = 0): SqlCompletionSpan {
  const beforeCursor = text.slice(0, cursorOffset)
  const memberMatch = beforeCursor.match(
    /((?:"(?:[^"]|"")*"|\[[^\]]*\]|`[^`]*`|[A-Za-z_][A-Za-z0-9_$]*))\.([A-Za-z_][A-Za-z0-9_$]*)?$/,
  )
  if (memberMatch) {
    const token = memberMatch[2] ?? ""
    return {
      replaceStart: statementStart + cursorOffset - token.length,
      replaceEnd: statementStart + cursorOffset,
      token,
      scopeName: normalizeIdentifier(memberMatch[1]),
      mode: "member",
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
