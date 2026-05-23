import type { BufferAutocompleteItem, BufferAutocompleteResult } from "../../../components/buffer"
import { docCharRange } from "../../../components/buffer/coords"
import type { SqlDialect } from "./dialect"
import {
  buildAliasMap,
  extractCteQueries,
  extractDerivedTables,
  extractTableRefs,
  findCompletionSpan,
  findCurrentClause,
  getCurrentSqlStatement,
  getInsertContext,
  getTempTableNames,
  isInsideSuppressedRegion,
  maskSql,
  normalizeIdentifier,
  type SqlClause,
  type SqlNamedQuery,
  type SqlTableRef,
} from "./sql-context"
import type { SqlRelation, SqlSchemaIndex } from "./sql-schema-index"

/* 100% LLM-generated, use tests as source of truth for expected behavior */

type RankedItem = BufferAutocompleteItem & {
  sortGroup: number
  keywordPriority: number
  matchText?: string
  matchMode?: "fuzzy" | "prefix"
}

type SqlAutocompleteInput = {
  text: string
  cursorOffset: number
  dialect: SqlDialect
  schema: SqlSchemaIndex
}

type TempRelation = SqlRelation & {
  source: "temp"
}

type InlineRelation = {
  id: string
  name: string
  kind: "cte" | "subquery"
  fullName: string
  columns: SqlRelation["columns"]
  source: "cte" | "derived"
}

type CompletionRelation = SqlRelation | TempRelation | InlineRelation

type ScopedCompletionRelation = {
  relation: CompletionRelation
  qualifier: string
}

type QueryScope = {
  text: string
  start: number
  visibleCtes: readonly SqlNamedQuery[]
  outerTexts: readonly string[]
}

type SqlCasePreference = "lower" | "upper"

type ArbitraryIdentifierSlot = { kind: "after-as" } | { kind: "after-relation"; token: string }

const STRUCTURAL_KEYWORDS = new Set([
  "from",
  "join",
  "into",
  "update",
  "set",
  "where",
  "on",
  "having",
  "insert",
  "delete",
  "group",
  "order",
  "left",
  "right",
  "inner",
  "outer",
  "full",
  "cross",
])
const SELECT_CLAUSE_KEYWORDS = ["*", "DISTINCT", "ALL"] as const
const EXPRESSION_KEYWORDS = [
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "AND",
  "OR",
  "NOT",
  "NULL",
  "IN",
  "EXISTS",
  "BETWEEN",
  "LIKE",
  "IS",
  "TRUE",
  "FALSE",
] as const
const ORDER_DIRECTION_KEYWORDS = ["ASC", "DESC"] as const
const GROUP_FOLLOWUP_KEYWORDS = ["HAVING", "ORDER BY", "LIMIT", "UNION"] as const
const ON_FOLLOWUP_KEYWORDS = ["AND", "OR", "WHERE", "JOIN", "GROUP BY", "ORDER BY", "LIMIT", "UNION"] as const
const ORDER_FOLLOWUP_KEYWORDS = ["LIMIT", "OFFSET", "UNION"] as const
const FROM_FOLLOWUP_KEYWORDS = ["WHERE", "JOIN", "GROUP BY", "ORDER BY", "LIMIT", "UNION"] as const
const WHERE_FOLLOWUP_KEYWORDS = ["AND", "OR", "GROUP BY", "ORDER BY", "LIMIT", "UNION"] as const
const HAVING_FOLLOWUP_KEYWORDS = ["AND", "OR", "ORDER BY", "LIMIT", "UNION"] as const
const JOIN_FOLLOWUP_KEYWORDS = ["ON", "USING"] as const
const FREQUENT_KEYWORD_PRIORITIES = new Set(["select", "from", "where", "join", "insert into"])
const EXACT_CLAUSE_KEYWORDS = new Set([
  "delete",
  "from",
  "group",
  "having",
  "insert",
  "into",
  "join",
  "limit",
  "offset",
  "on",
  "order",
  "select",
  "set",
  "update",
  "where",
  "with",
])
const EXACT_COMPLETED_KEYWORDS = new Set([
  ...EXACT_CLAUSE_KEYWORDS,
  ...SELECT_CLAUSE_KEYWORDS.map((keyword) => keyword.toLowerCase()),
  ...EXPRESSION_KEYWORDS.map((keyword) => keyword.toLowerCase()),
  ...ORDER_DIRECTION_KEYWORDS.map((keyword) => keyword.toLowerCase()),
])
const PROJECTION_ALIAS_RESERVED_WORDS = new Set([
  ...STRUCTURAL_KEYWORDS,
  ...SELECT_CLAUSE_KEYWORDS.map((keyword) => keyword.toLowerCase()),
  ...EXPRESSION_KEYWORDS.map((keyword) => keyword.toLowerCase()),
  ...ORDER_DIRECTION_KEYWORDS.map((keyword) => keyword.toLowerCase()),
  "all",
  "asc",
  "by",
  "desc",
  "group",
  "limit",
  "offset",
  "order",
  "union",
])
const IDENTIFIER = '(?:"(?:[^"]|"")+"|\\[[^\\]]+\\]|`[^`]+`|[A-Za-z_][A-Za-z0-9_$]*)'
const QUALIFIED_IDENTIFIER = `${IDENTIFIER}(?:\\s*\\.\\s*${IDENTIFIER}){0,2}`
const KEYWORD_FOLLOW_UP_PATTERNS = [
  { pattern: /\bwith\s+([A-Za-z_]*)$/i, keywords: ["RECURSIVE"] },
  { pattern: /\binsert\s+([A-Za-z_]*)$/i, keywords: ["INTO"] },
  { pattern: /\bdelete\s+([A-Za-z_]*)$/i, keywords: ["FROM"] },
  { pattern: /\bgroup\s+([A-Za-z_]*)$/i, keywords: ["BY"] },
  { pattern: /\border\s+([A-Za-z_]*)$/i, keywords: ["BY"] },
  { pattern: /\b(?:left|right|inner|outer|full|cross)\s+([A-Za-z_]*)$/i, keywords: ["JOIN"] },
] as const
const INSERT_FOLLOW_UP_KEYWORDS = ["VALUES", "SELECT", "DEFAULT VALUES"] as const
const SIMPLE_IDENTIFIER = /^[a-z_][a-z0-9_$]*$/
const UNIQUE_RANKED_ITEM_KEYS = new WeakMap<RankedItem[], Set<string>>()
const UNIQUE_COLUMN_KEYS = new WeakMap<SqlRelation["columns"], Set<string>>()

function rankedItemKey(item: Pick<RankedItem, "label" | "description" | "meta" | "insertText">) {
  return `${item.label}:${item.description ?? ""}:${item.meta ?? ""}:${item.insertText}`
}

function formatSqlIdentifier(value: string) {
  if (SIMPLE_IDENTIFIER.test(value)) {
    return value
  }

  return `"${value.replaceAll('"', '""')}"`
}

function buildRelationLookupNames(ref: { database?: string; schema?: string; name: string }) {
  const names: string[] = []
  if (ref.database && ref.schema) {
    names.push(`${ref.database}.${ref.schema}.${ref.name}`)
  }
  if (ref.schema) {
    names.push(`${ref.schema}.${ref.name}`)
  }
  names.push(ref.name)
  return names
}

function pushUniqueColumns(target: SqlRelation["columns"], columns: readonly SqlRelation["columns"][number][]) {
  let seen = UNIQUE_COLUMN_KEYS.get(target)
  if (!seen) {
    seen = new Set(target.map((item) => normalize(item.name)))
    UNIQUE_COLUMN_KEYS.set(target, seen)
  }

  for (const column of columns) {
    const key = normalize(column.name)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    target.push(column)
  }
}

function splitTopLevelSqlList(text: string) {
  const masked = maskSql(text)
  const parts: string[] = []
  let depth = 0
  let start = 0

  for (let i = 0; i < masked.length; i += 1) {
    const ch = masked[i]
    if (ch === "(") {
      depth += 1
      continue
    }
    if (ch === ")") {
      depth = Math.max(0, depth - 1)
      continue
    }
    if (depth === 0 && ch === ",") {
      parts.push(text.slice(start, i))
      start = i + 1
    }
  }

  parts.push(text.slice(start))
  return parts
}

function findTopLevelKeyword(text: string, keyword: string, from = 0) {
  const masked = maskSql(text)
  const needle = keyword.toLowerCase()
  let depth = 0
  let token = ""
  let tokenStart = -1

  for (let i = from; i < masked.length; i += 1) {
    const ch = masked[i] ?? ""
    if (ch === "(") {
      if (depth === 0 && token && token.toLowerCase() === needle) {
        return tokenStart
      }
      depth += 1
      token = ""
      tokenStart = -1
      continue
    }
    if (ch === ")") {
      if (depth === 0 && token && token.toLowerCase() === needle) {
        return tokenStart
      }
      depth = Math.max(0, depth - 1)
      token = ""
      tokenStart = -1
      continue
    }
    if (depth > 0) {
      continue
    }

    const isWord = /[A-Za-z_]/.test(ch) || (token && /[A-Za-z0-9_$]/.test(ch))
    if (isWord) {
      if (!token) {
        tokenStart = i
      }
      token += ch
      continue
    }
    if (!token) {
      continue
    }
    if (token.toLowerCase() === needle) {
      return tokenStart
    }
    token = ""
    tokenStart = -1
  }

  if (token && token.toLowerCase() === needle) {
    return tokenStart
  }
}

function findMatchingParen(masked: string, openIndex: number) {
  if (masked[openIndex] !== "(") {
    return undefined
  }

  let depth = 0
  for (let i = openIndex; i < masked.length; i += 1) {
    const ch = masked[i]
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

function getNestedQueryScope(text: string, cursorOffset: number): Pick<QueryScope, "text" | "start" | "outerTexts"> {
  const masked = maskSql(text, true)
  const stack: number[] = []

  for (let i = 0; i < Math.min(cursorOffset, masked.length); i += 1) {
    const ch = masked[i]
    if (ch === "(") {
      stack.push(i)
      continue
    }
    if (ch === ")") {
      stack.pop()
    }
  }

  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const openIndex = stack[i]
    const start = openIndex + 1
    const relativeCursor = cursorOffset - start
    if (relativeCursor < 0) {
      continue
    }

    const beforeCursor = text.slice(start, cursorOffset)
    if (
      findTopLevelKeyword(beforeCursor, "select") === undefined &&
      findTopLevelKeyword(beforeCursor, "with") === undefined
    ) {
      continue
    }

    const end = findMatchingParen(masked, openIndex) ?? text.length
    const inner = text.slice(start, end)
    const nested = getNestedQueryScope(inner, relativeCursor)
    return {
      text: nested.text,
      start: start + nested.start,
      // Keep only the visible prefix before this nested query so we do not
      // leak aliases declared later in the outer scope.
      outerTexts: [text.slice(0, openIndex), ...nested.outerTexts],
    }
  }

  return {
    text,
    start: 0,
    outerTexts: [],
  }
}

function getActiveQueryScope(statementText: string, cursorOffset: number): QueryScope {
  const ctes = extractCteQueries(statementText)

  for (let i = 0; i < ctes.length; i += 1) {
    const cte = ctes[i]
    if (cursorOffset < cte.queryStart || cursorOffset > cte.queryEnd) {
      continue
    }

    const nested = getNestedQueryScope(cte.query, cursorOffset - cte.queryStart)
    return {
      text: nested.text,
      start: cte.queryStart + nested.start,
      visibleCtes: cte.recursive ? [...ctes.slice(0, i), cte] : ctes.slice(0, i),
      outerTexts: nested.outerTexts,
    }
  }

  const last = ctes.at(-1)
  if (!last || cursorOffset < last.queryEnd + 1) {
    const nested = getNestedQueryScope(statementText, cursorOffset)
    return {
      text: nested.text,
      start: nested.start,
      visibleCtes: [],
      outerTexts: nested.outerTexts,
    }
  }

  const start = last.queryEnd + 1
  const nested = getNestedQueryScope(statementText.slice(start), cursorOffset - start)
  return {
    text: nested.text,
    start: start + nested.start,
    visibleCtes: ctes,
    outerTexts: nested.outerTexts,
  }
}

function normalize(value: string) {
  return value.toLowerCase()
}

function hasLetters(value: string) {
  return /[A-Za-z]/.test(value)
}

function inferSqlCasePreference(beforeCursor: string, token: string): SqlCasePreference {
  if (hasLetters(token)) {
    return token === token.toLowerCase() ? "lower" : "upper"
  }

  const lookback = beforeCursor.trimEnd().match(/([A-Za-z_][A-Za-z0-9_$]*)$/)?.[1]
  if (!lookback || !hasLetters(lookback)) {
    return "upper"
  }

  return lookback === lookback.toLowerCase() ? "lower" : "upper"
}

function currentLinePrefix(beforeCursor: string) {
  return beforeCursor.slice(beforeCursor.lastIndexOf("\n") + 1)
}

function readAliasLikeToken(value: string) {
  return value.match(/([A-Za-z_][A-Za-z0-9_$]*)$/)?.[1] ?? ""
}

function getArbitraryIdentifierSlot(beforeCursor: string): ArbitraryIdentifierSlot | undefined {
  const line = currentLinePrefix(beforeCursor)
  const token = readAliasLikeToken(line)
  const relationPatterns = [
    new RegExp(`\\bfrom\\s+${QUALIFIED_IDENTIFIER}\\s+([A-Za-z_][A-Za-z0-9_$]*)$`, "i"),
    new RegExp(`\\bjoin\\s+${QUALIFIED_IDENTIFIER}\\s+([A-Za-z_][A-Za-z0-9_$]*)$`, "i"),
    new RegExp(`\\bupdate\\s+${QUALIFIED_IDENTIFIER}\\s+([A-Za-z_][A-Za-z0-9_$]*)$`, "i"),
    /^\s*\)\s+([A-Za-z_][A-Za-z0-9_$]*)$/i,
  ]
  const afterAsPatterns = [
    new RegExp(`\\bfrom\\s+${QUALIFIED_IDENTIFIER}\\s+as(?:\\s+[A-Za-z_][A-Za-z0-9_$]*)?$`, "i"),
    new RegExp(`\\bjoin\\s+${QUALIFIED_IDENTIFIER}\\s+as(?:\\s+[A-Za-z_][A-Za-z0-9_$]*)?$`, "i"),
    new RegExp(`\\bupdate\\s+${QUALIFIED_IDENTIFIER}\\s+as(?:\\s+[A-Za-z_][A-Za-z0-9_$]*)?$`, "i"),
    /^\s*\)\s+as(?:\s+[A-Za-z_][A-Za-z0-9_$]*)?$/i,
    /\bwith\s+recursive\s+[A-Za-z_][A-Za-z0-9_$]*\s+as(?:\s+[A-Za-z_][A-Za-z0-9_$]*)?$/i,
    /\bas(?:\s+[A-Za-z_][A-Za-z0-9_$]*)?$/i,
  ]
  if (afterAsPatterns.some((pattern) => pattern.test(line))) {
    return { kind: "after-as" }
  }
  if (/\bdelete\s+from\s+/i.test(line)) {
    return undefined
  }
  if (!token || !relationPatterns.some((pattern) => pattern.test(line))) {
    return undefined
  }
  return { kind: "after-relation", token }
}

function isExistsQueryStartContext(beforeCursor: string, token: string) {
  if (!token) {
    return false
  }

  return new RegExp(`\\bexists\\s*\\(\\s*${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i").test(beforeCursor)
}

function shouldShowClauseFollowUpsOnly(
  beforeCursor: string,
  clause: SqlClause,
  token: string,
  keywords: readonly string[],
) {
  if (!token || !["where", "having", "on"].includes(clause)) {
    return false
  }
  const tail = beforeCursor
    .slice(0, beforeCursor.length - token.length)
    .trimEnd()
    .toLowerCase()
  if (tail.endsWith("where") || tail.endsWith("having") || tail.endsWith("on")) {
    return false
  }
  return keywords.some((keyword) => normalize(keyword).startsWith(normalize(token)))
}

function formatSqlVocabulary(value: string, preference: SqlCasePreference) {
  return preference === "lower" ? value.toLowerCase() : value.toUpperCase()
}

function matchKeywordPrefix(keywords: readonly string[], token: string, preference: SqlCasePreference) {
  if (!token) {
    return [...keywords]
  }

  return keywords.filter((keyword) => formatSqlVocabulary(keyword, preference).startsWith(token))
}

function pushUnique(target: RankedItem[], item: RankedItem) {
  let seen = UNIQUE_RANKED_ITEM_KEYS.get(target)
  if (!seen) {
    seen = new Set(target.map((entry) => rankedItemKey(entry)))
    UNIQUE_RANKED_ITEM_KEYS.set(target, seen)
  }

  const key = rankedItemKey(item)
  if (seen.has(key)) {
    return
  }
  seen.add(key)
  target.push(item)
}

function scoreMatch(query: string, value: string) {
  if (!query) {
    return { tier: 0, score: 0 }
  }

  const q = normalize(query)
  const target = normalize(value)
  if (target === q) {
    return { tier: 0, score: target.length }
  }
  if (target.startsWith(q)) {
    return { tier: 1, score: target.length }
  }

  let searchFrom = 0
  let firstIndex = -1
  for (const ch of q) {
    const index = target.indexOf(ch, searchFrom)
    if (index === -1) {
      return null
    }
    if (firstIndex === -1) {
      firstIndex = index
    }
    searchFrom = index + 1
  }

  return { tier: 2, score: firstIndex * 10 + target.length }
}

function scorePrefixMatch(query: string, value: string) {
  if (!query) {
    return { tier: 0, score: 0 }
  }

  const q = normalize(query)
  const target = normalize(value)
  if (target === q) {
    return { tier: 0, score: target.length }
  }
  if (target.startsWith(q)) {
    return { tier: 1, score: target.length }
  }
  return null
}

function scoreItem(query: string, item: RankedItem) {
  if (item.matchMode === "prefix") {
    return scorePrefixMatch(query, item.matchText ?? item.label)
  }
  return scoreMatch(query, item.matchText ?? item.label)
}

function sortItems(query: string, items: RankedItem[]) {
  return items
    .map((item) => ({ item, match: scoreItem(query, item) }))
    .filter((entry): entry is { item: RankedItem; match: { tier: number; score: number } } => Boolean(entry.match))
    .sort((a, b) => {
      if (a.item.sortGroup !== b.item.sortGroup) {
        return a.item.sortGroup - b.item.sortGroup
      }
      if (a.match.tier !== b.match.tier) {
        return a.match.tier - b.match.tier
      }
      if (a.item.keywordPriority !== b.item.keywordPriority) {
        return b.item.keywordPriority - a.item.keywordPriority
      }
      if (a.match.score !== b.match.score) {
        return a.match.score - b.match.score
      }
      return a.item.label.localeCompare(b.item.label)
    })
    .map((entry) => ({
      id: entry.item.id,
      label: entry.item.label,
      insertText: entry.item.insertText,
      description: entry.item.description,
      meta: entry.item.meta,
      cursorOffset: entry.item.cursorOffset,
    }))
}

function createInlineRelation(
  name: string,
  kind: InlineRelation["kind"],
  source: InlineRelation["source"],
  columns: SqlRelation["columns"],
): InlineRelation {
  return {
    id: `${source}:${name}`,
    name,
    kind,
    fullName: name,
    columns,
    source,
  }
}

function resolveDerivedColumns(
  derived: ReturnType<typeof extractDerivedTables>[number],
  schema: SqlSchemaIndex,
  tempRelations: readonly TempRelation[],
  cteRelations: ReadonlyMap<string, InlineRelation>,
  cache: Map<string, SqlRelation["columns"]>,
  active: Set<string>,
) {
  const inferred = inferQueryColumns(derived.query, schema, tempRelations, cteRelations, cache, active)
  if (derived.columns.length === 0) {
    return inferred
  }

  const columns = derived.columns.map((name, index) => ({
    id: inferred[index]?.id ?? `derived:${derived.alias}:${index}`,
    name,
    dataType: inferred[index]?.dataType,
  }))

  pushUniqueColumns(columns, inferred.slice(derived.columns.length))
  return columns
}

function resolveSchemaRelation(schema: SqlSchemaIndex, ref: { database?: string; schema?: string; name: string }) {
  for (const name of buildRelationLookupNames(ref)) {
    const relation = schema.findRelations(name)[0]
    if (relation) {
      return relation
    }
  }
}

function extractProjectionAlias(expression: string) {
  const asMatch = expression.match(/\s+as\s+((?:"(?:[^"]|"")+"|\[[^\]]+\]|`[^`]+`|[A-Za-z_][A-Za-z0-9_$]*))\s*$/i)
  if (asMatch?.[1]) {
    return normalizeIdentifier(asMatch[1])
  }

  const implicitMatch = expression.match(new RegExp(`^([\\s\\S]*\\S)\\s+(${IDENTIFIER})\\s*$`, "i"))
  if (implicitMatch?.[2]) {
    const raw = implicitMatch[2]
    const name = normalizeIdentifier(raw)
    if (name && (raw !== name || !PROJECTION_ALIAS_RESERVED_WORDS.has(name.toLowerCase()))) {
      return name
    }
  }

  const nameMatch = expression.match(/(?:^|\.)\s*((?:"(?:[^"]|"")+"|\[[^\]]+\]|`[^`]+`|[A-Za-z_][A-Za-z0-9_$]*))\s*$/)
  return normalizeIdentifier(nameMatch?.[1])
}

function resolveScopedRelation(
  scopeName: string,
  relations: readonly CompletionRelation[],
  aliases: ReadonlyMap<string, SqlTableRef>,
  schema: SqlSchemaIndex,
  tempRelations: readonly TempRelation[],
  cteRelations: ReadonlyMap<string, InlineRelation>,
  scopedRelations: readonly ScopedCompletionRelation[] = [],
) {
  const scoped = scopedRelations.find((ref) => normalize(ref.qualifier) === normalize(scopeName))
  if (scoped) {
    return scoped.relation
  }

  const alias = aliases.get(scopeName.toLowerCase())
  const scopedByAlias = alias ? resolveNamedRelation(schema, alias, tempRelations, cteRelations) : undefined
  if (scopedByAlias) {
    return scopedByAlias
  }

  return relations.find((relation) => normalize(relation.name) === normalize(scopeName))
}

function inferQueryColumns(
  queryText: string,
  schema: SqlSchemaIndex,
  tempRelations: readonly TempRelation[],
  parentCtes: ReadonlyMap<string, InlineRelation>,
  cache: Map<string, SqlRelation["columns"]>,
  active: Set<string>,
): SqlRelation["columns"] {
  const key = queryText.trim()
  const cached = cache.get(key)
  if (cached) {
    return cached
  }
  if (active.has(key)) {
    return []
  }

  active.add(key)
  const cteRelations = buildCteRelationMap(
    extractCteQueries(queryText),
    schema,
    tempRelations,
    parentCtes,
    cache,
    active,
  )
  const refs = extractTableRefs(queryText)
  const aliases = buildAliasMap(refs)
  const relations = resolveReferencedRelations(schema, queryText, tempRelations, cteRelations, cache, active)
  const selectIndex = findTopLevelKeyword(queryText, "select")
  if (selectIndex === undefined) {
    active.delete(key)
    cache.set(key, [])
    return []
  }

  const fromIndex = findTopLevelKeyword(queryText, "from", selectIndex + 6)
  const selectList = queryText.slice(selectIndex + 6, fromIndex ?? queryText.length)
  const columns: SqlRelation["columns"] = []

  for (const rawPart of splitTopLevelSqlList(selectList)) {
    const part = rawPart.trim()
    if (!part) {
      continue
    }
    if (part === "*") {
      for (const relation of relations) {
        pushUniqueColumns(columns, relation.columns)
      }
      continue
    }

    const starMatch = part.match(/^(?:"(?:[^"]|"")+"|\[[^\]]+\]|`[^`]+`|[A-Za-z_][A-Za-z0-9_$]*)\s*\.\s*\*$/)
    if (starMatch?.[0]) {
      const scopeName = normalizeIdentifier(part.replace(/\s*\.\s*\*$/, ""))
      if (scopeName) {
        const scopedRelation = resolveScopedRelation(scopeName, relations, aliases, schema, tempRelations, cteRelations)
        if (scopedRelation) {
          pushUniqueColumns(columns, scopedRelation.columns)
        }
      }
      continue
    }

    const name = extractProjectionAlias(part)
    if (!name) {
      continue
    }

    pushUniqueColumns(columns, [
      {
        id: `projection:${key}:${name}`,
        name,
      },
    ])
  }

  active.delete(key)
  cache.set(key, columns)
  return columns
}

function buildCteRelationMap(
  queries: readonly SqlNamedQuery[],
  schema: SqlSchemaIndex,
  tempRelations: readonly TempRelation[],
  parentCtes: ReadonlyMap<string, InlineRelation>,
  cache: Map<string, SqlRelation["columns"]>,
  active: Set<string>,
) {
  const ctes = new Map(parentCtes)

  for (const cte of queries) {
    const columns =
      cte.columns.length > 0
        ? cte.columns.map((name) => ({
            id: `cte:${cte.name}:${name}`,
            name,
          }))
        : inferQueryColumns(cte.query, schema, tempRelations, ctes, cache, active)
    ctes.set(normalize(cte.name), createInlineRelation(cte.name, "cte", "cte", columns))
  }

  return ctes
}

function relationDetail(relation: CompletionRelation) {
  if ("source" in relation) {
    if (relation.source === "temp") {
      return `temp ${relation.kind}`
    }
    return relation.kind
  }

  const parts: string[] = [relation.kind]
  if ("schema" in relation && relation.schema) {
    parts.push(relation.schema)
  }
  return parts.join(" ")
}

function addRelationItems(target: RankedItem[], relations: readonly CompletionRelation[], sortGroup: number) {
  for (const relation of relations) {
    pushUnique(target, {
      id: relation.id,
      label: relation.name,
      insertText: formatSqlIdentifier(relation.name),
      description: relationDetail(relation),
      sortGroup,
      keywordPriority: 0,
    })
  }
}

function addColumnItems(target: RankedItem[], relations: readonly CompletionRelation[], sortGroup: number) {
  for (const relation of relations) {
    for (const column of relation.columns) {
      pushUnique(target, {
        id: column.id,
        label: column.name,
        insertText: formatSqlIdentifier(column.name),
        description: relation.name,
        meta: column.dataType,
        sortGroup,
        keywordPriority: 0,
      })
    }
  }
}

function addQueryColumnItems(
  target: RankedItem[],
  columns: readonly SqlRelation["columns"][number][],
  sortGroup: number,
) {
  for (const column of columns) {
    pushUnique(target, {
      id: column.id,
      label: column.name,
      insertText: formatSqlIdentifier(column.name),
      description: "select-list",
      sortGroup,
      keywordPriority: 0,
    })
  }
}

function addScopedColumnItems(target: RankedItem[], refs: readonly ScopedCompletionRelation[], sortGroup: number) {
  const columns = new Map<
    string,
    Array<{ relation: CompletionRelation; qualifier: string; column: SqlRelation["columns"][number] }>
  >()

  for (const ref of refs) {
    for (const column of ref.relation.columns) {
      const key = normalize(column.name)
      const current = columns.get(key)
      const item = { relation: ref.relation, qualifier: ref.qualifier, column }
      if (current) {
        current.push(item)
        continue
      }
      columns.set(key, [item])
    }
  }

  for (const matches of columns.values()) {
    if (matches.length === 1) {
      const match = matches[0]
      pushUnique(target, {
        id: match.column.id,
        label: match.column.name,
        insertText: formatSqlIdentifier(match.column.name),
        description: match.relation.name,
        meta: match.column.dataType,
        sortGroup,
        keywordPriority: 0,
      })
      continue
    }

    for (const match of matches) {
      const qualifier = formatSqlIdentifier(match.qualifier)
      const column = formatSqlIdentifier(match.column.name)
      pushUnique(target, {
        id: `${match.column.id}:${match.qualifier}`,
        label: `${qualifier}.${column}`,
        insertText: `${qualifier}.${column}`,
        description: match.relation.name,
        meta: match.column.dataType,
        sortGroup,
        keywordPriority: 0,
        matchText: match.column.name,
      })
    }
  }
}

function addScopedRelationItems(target: RankedItem[], refs: readonly ScopedCompletionRelation[], sortGroup: number) {
  for (const ref of refs) {
    pushUnique(target, {
      id: `${ref.relation.id}:${ref.qualifier}`,
      label: ref.qualifier,
      insertText: formatSqlIdentifier(ref.qualifier),
      description: relationDetail(ref.relation),
      sortGroup,
      keywordPriority: 0,
      matchMode: "prefix",
    })
  }
}

function addKeywordItems(
  target: RankedItem[],
  keywords: readonly string[],
  sortGroup: number,
  casePreference: SqlCasePreference,
) {
  for (const keyword of keywords) {
    const formatted = formatSqlVocabulary(keyword, casePreference)
    pushUnique(target, {
      id: `keyword:${keyword}`,
      label: formatted,
      insertText: formatted,
      sortGroup,
      keywordPriority: FREQUENT_KEYWORD_PRIORITIES.has(normalize(keyword)) ? 1 : 0,
      matchMode: "prefix",
    })
  }
}

function addFunctionItems(
  target: RankedItem[],
  dialect: SqlDialect,
  sortGroup: number,
  casePreference: SqlCasePreference,
) {
  for (const fn of dialect.functions) {
    const formatted = formatSqlVocabulary(fn, casePreference)
    pushUnique(target, {
      id: `function:${fn}`,
      label: formatted,
      insertText: `${formatted}()`,
      cursorOffset: formatted.length + 1,
      description: "function",
      sortGroup,
      keywordPriority: 0,
      matchMode: "prefix",
    })
  }
}

function addOperatorItems(
  target: RankedItem[],
  dialect: SqlDialect,
  sortGroup: number,
  casePreference: SqlCasePreference,
) {
  for (const operator of dialect.operators) {
    if (operator.includes(" ")) {
      continue
    }

    const formatted = formatSqlVocabulary(operator, casePreference)
    pushUnique(target, {
      id: `operator:${operator}`,
      label: formatted,
      insertText: formatted,
      description: "operator",
      sortGroup,
      keywordPriority: 0,
      matchMode: "prefix",
    })
  }
}

function isExpressionComplete(body: string | undefined) {
  if (!body) {
    return false
  }
  if (/[,(]$/.test(body)) {
    return false
  }
  return !/(?:=|<>|!=|<=|>=|<|>|\+|-|\*|\/|%|\b(?:and|or|not|like|ilike|in|is|between|when|then)\b)$/i.test(body)
}

function addCteItems(target: RankedItem[], ctes: readonly string[], sortGroup: number) {
  for (const cte of ctes) {
    pushUnique(target, {
      id: `cte:${cte}`,
      label: cte,
      insertText: formatSqlIdentifier(cte),
      description: "cte",
      sortGroup,
      keywordPriority: 0,
      matchMode: "prefix",
    })
  }
}

function findUniquePrefixMatch<T extends { name: string }>(items: readonly T[], value: string) {
  const matches = items.filter((item) => normalize(item.name).startsWith(normalize(value)))
  if (matches.length !== 1) {
    return undefined
  }
  return matches[0]
}

function resolveNamedRelation(
  schema: SqlSchemaIndex,
  ref: SqlTableRef,
  tempRelations: readonly TempRelation[],
  cteRelations: ReadonlyMap<string, InlineRelation>,
) {
  const cte = cteRelations.get(normalize(ref.name))
  if (cte) {
    return cte
  }

  const prefixedCte = findUniquePrefixMatch(Array.from(cteRelations.values()), ref.name)
  if (prefixedCte) {
    return prefixedCte
  }

  const relation = resolveSchemaRelation(schema, ref)
  if (relation) {
    return relation
  }

  const tempRelation = tempRelations.find((item) => normalize(item.name) === normalize(ref.name))
  if (tempRelation) {
    return tempRelation
  }

  return findUniquePrefixMatch(tempRelations, ref.name)
}

function resolveReferencedRelations(
  schema: SqlSchemaIndex,
  statementText: string,
  tempRelations: readonly TempRelation[],
  cteRelations: ReadonlyMap<string, InlineRelation>,
  cache: Map<string, SqlRelation["columns"]>,
  active: Set<string>,
) {
  const resolved: CompletionRelation[] = []

  for (const ref of extractTableRefs(statementText)) {
    const relation = resolveNamedRelation(schema, ref, tempRelations, cteRelations)
    if (relation) {
      if (resolved.some((item) => item.id === relation.id)) {
        continue
      }
      resolved.push(relation)
    }
  }

  for (const derived of extractDerivedTables(statementText)) {
    const relation = createInlineRelation(
      derived.alias,
      "subquery",
      "derived",
      resolveDerivedColumns(derived, schema, tempRelations, cteRelations, cache, active),
    )
    if (resolved.some((item) => item.id === relation.id)) {
      continue
    }
    resolved.push(relation)
  }

  return resolved
}

function resolveScopedCompletionRelations(
  schema: SqlSchemaIndex,
  refs: readonly SqlTableRef[],
  statementText: string,
  tempRelations: readonly TempRelation[],
  cteRelations: ReadonlyMap<string, InlineRelation>,
  cache: Map<string, SqlRelation["columns"]>,
  active: Set<string>,
) {
  const scoped: ScopedCompletionRelation[] = []

  for (const ref of refs) {
    const relation = resolveNamedRelation(schema, ref, tempRelations, cteRelations)
    if (!relation) {
      continue
    }

    scoped.push({
      relation,
      qualifier: ref.alias ?? ref.name,
    })
  }

  for (const derived of extractDerivedTables(statementText)) {
    const relation = createInlineRelation(
      derived.alias,
      "subquery",
      "derived",
      resolveDerivedColumns(derived, schema, tempRelations, cteRelations, cache, active),
    )
    scoped.push({
      relation,
      qualifier: derived.alias,
    })
  }

  return scoped
}

function resolveRelation(schema: SqlSchemaIndex, ref: { database?: string; schema?: string; name: string }) {
  return resolveSchemaRelation(schema, ref)
}

function expectsTableSuggestions(clause: SqlClause) {
  return clause === "from" || clause === "join" || clause === "into"
}

function expectsColumnSuggestions(clause: SqlClause) {
  return (
    clause === "select" ||
    clause === "where" ||
    clause === "having" ||
    clause === "group" ||
    clause === "order" ||
    clause === "set" ||
    clause === "on"
  )
}

function getPostRelationKeywordOptions(beforeCursor: string, clause: SqlClause, dialect: SqlDialect) {
  if (clause !== "from" && clause !== "join") {
    return []
  }

  if (clause === "join") {
    const usingPatterns = [
      new RegExp(`\\bJOIN\\s+${QUALIFIED_IDENTIFIER}\\s+USING\\s*\\([^()]*\\)\\s+(\\w*)$`, "i"),
      new RegExp(`\\bJOIN\\s+${QUALIFIED_IDENTIFIER}\\s+AS\\s+${IDENTIFIER}\\s+USING\\s*\\([^()]*\\)\\s+(\\w*)$`, "i"),
      new RegExp(`\\bJOIN\\s+${QUALIFIED_IDENTIFIER}\\s+${IDENTIFIER}\\s+USING\\s*\\([^()]*\\)\\s+(\\w*)$`, "i"),
    ]
    if (usingPatterns.some((pattern) => pattern.test(beforeCursor))) {
      return [...ON_FOLLOWUP_KEYWORDS]
    }
  }

  const keyword = clause === "join" ? "JOIN" : "FROM"
  const patterns = [
    new RegExp(`\\b${keyword}\\s+${QUALIFIED_IDENTIFIER}\\s+(\\w*)$`, "i"),
    new RegExp(`\\b${keyword}\\s+${QUALIFIED_IDENTIFIER}\\s+AS\\s+${IDENTIFIER}\\s+(\\w*)$`, "i"),
    new RegExp(`\\b${keyword}\\s+${QUALIFIED_IDENTIFIER}\\s+${IDENTIFIER}\\s+(\\w*)$`, "i"),
  ]
  if (!patterns.some((pattern) => pattern.test(beforeCursor))) {
    return []
  }

  if (clause === "from" && /\bdelete\s+from\s+/i.test(beforeCursor)) {
    const keywords = ["WHERE"]
    if (dialect.keywords.includes("RETURNING")) {
      keywords.push("RETURNING")
    }
    return keywords
  }

  if (clause === "join") {
    return [...JOIN_FOLLOWUP_KEYWORDS]
  }
  return [...FROM_FOLLOWUP_KEYWORDS]
}

function getUpdateSetKeywordOptions(beforeCursor: string) {
  const patterns = [
    new RegExp(`\\bUPDATE\\s+${QUALIFIED_IDENTIFIER}\\s+(\\w*)$`, "i"),
    new RegExp(`\\bUPDATE\\s+${QUALIFIED_IDENTIFIER}\\s+AS\\s+${IDENTIFIER}\\s+(\\w*)$`, "i"),
    new RegExp(`\\bUPDATE\\s+${QUALIFIED_IDENTIFIER}\\s+${IDENTIFIER}\\s+(\\w*)$`, "i"),
  ]
  if (!patterns.some((pattern) => pattern.test(beforeCursor))) {
    return []
  }

  return matchKeywordPrefix(["SET"], beforeCursor.match(/(\w*)$/)?.[1] ?? "", inferSqlCasePreference(beforeCursor, ""))
}

function getKeywordFollowUpOptions(beforeCursor: string) {
  for (const entry of KEYWORD_FOLLOW_UP_PATTERNS) {
    const match = beforeCursor.match(entry.pattern)
    if (!match) {
      continue
    }
    return [...entry.keywords]
  }

  return []
}

function getClauseFollowUpOptions(beforeCursor: string, clause: SqlClause) {
  const token = beforeCursor.match(/(\w*)$/)?.[1] ?? ""
  const tail = beforeCursor.slice(0, beforeCursor.length - token.length).trimEnd()

  if (clause === "group") {
    const body = tail.match(/\bgroup\s+by\s+([\s\S]*)$/i)?.[1]?.trimEnd()
    if (!body || body.endsWith(",")) {
      return []
    }
    return [...GROUP_FOLLOWUP_KEYWORDS]
  }

  if (clause === "order") {
    const body = tail.match(/\border\s+by\s+([\s\S]*)$/i)?.[1]?.trimEnd()
    if (!body || body.endsWith(",")) {
      return []
    }
    return [...ORDER_FOLLOWUP_KEYWORDS]
  }

  if (clause === "where") {
    const body = tail.match(/\bwhere\s+([\s\S]*)$/i)?.[1]?.trimEnd()
    if (!isExpressionComplete(body)) {
      return []
    }
    return [...WHERE_FOLLOWUP_KEYWORDS]
  }

  if (clause === "having") {
    const body = tail.match(/\bhaving\s+([\s\S]*)$/i)?.[1]?.trimEnd()
    if (!isExpressionComplete(body)) {
      return []
    }
    return [...HAVING_FOLLOWUP_KEYWORDS]
  }

  if (clause === "on") {
    const body = tail.match(/\bon\s+([\s\S]*)$/i)?.[1]?.trimEnd()
    if (!isExpressionComplete(body)) {
      return []
    }
    return [...ON_FOLLOWUP_KEYWORDS]
  }

  return []
}

function getSelectFollowUpOptions(beforeCursor: string) {
  const token = beforeCursor.match(/(\w*)$/)?.[1] ?? ""
  const tail = beforeCursor.slice(0, beforeCursor.length - token.length).trimEnd()
  if (/\bunion(?:\s+all)?$/i.test(tail)) {
    return matchKeywordPrefix(["SELECT"], token, inferSqlCasePreference(beforeCursor, token))
  }

  const body = tail.match(/\bselect\s+([\s\S]*)$/i)?.[1]?.trimEnd()
  if (!isExpressionComplete(body)) {
    return []
  }

  return matchKeywordPrefix(["UNION", "UNION ALL"], token, inferSqlCasePreference(beforeCursor, token))
}

function shouldPreferFrom(beforeCursor: string, token: string) {
  const query = token.toLowerCase()
  const matchesSelectStar = /\bSELECT\s+\*\s+\w*$/i.test(beforeCursor) || /\bSELECT\s+\*\s*$/i.test(beforeCursor)
  if (!matchesSelectStar) {
    return query.length >= 2 && "from".startsWith(query)
  }

  return !query || "from".startsWith(query)
}

function shouldOpenImplicit(beforeCursor: string, token: string, mode: "word" | "member") {
  if (mode === "member") {
    return true
  }
  if (token.length > 0) {
    return true
  }
  return /\b(?:from|join)[ \t]+$/i.test(beforeCursor)
}

function shouldSuppressExactKeyword(token: string, mode: "word" | "member", clause: SqlClause, dialect: SqlDialect) {
  if (mode !== "word" || !token) {
    return false
  }
  if (expectsTableSuggestions(clause)) {
    return false
  }

  const exact = normalize(token)
  if (EXACT_CLAUSE_KEYWORDS.has(exact)) {
    return true
  }
  if (!expectsColumnSuggestions(clause)) {
    return false
  }

  return EXACT_COMPLETED_KEYWORDS.has(exact) || dialect.keywords.some((keyword) => normalize(keyword) === exact)
}

function shouldSuppressExactScopedQualifier(
  token: string,
  mode: "word" | "member",
  clause: SqlClause,
  refs: readonly ScopedCompletionRelation[],
) {
  if (mode !== "word" || !token || !["select", "where", "having", "on", "set"].includes(clause)) {
    return false
  }

  return refs.some((ref) => normalize(ref.qualifier) === normalize(token))
}

function isNoOpCompletion(statementText: string, cursorOffset: number, item: BufferAutocompleteItem) {
  const span = findCompletionSpan(statementText, cursorOffset)
  const current = statementText.slice(span.replaceStart, span.replaceEnd)
  return current === item.insertText
}

export function getSqlAutocompleteResult(input: SqlAutocompleteInput): BufferAutocompleteResult | undefined {
  const statement = getCurrentSqlStatement(input.text, input.cursorOffset)
  if (!statement) {
    return undefined
  }
  if (isInsideSuppressedRegion(statement.text, statement.cursorOffset)) {
    return undefined
  }

  const beforeCursor = statement.text.slice(0, statement.cursorOffset)
  if (!beforeCursor.trim()) {
    return undefined
  }
  if (beforeCursor.trimEnd().endsWith(";")) {
    return undefined
  }

  const clause = findCurrentClause(statement.text, statement.cursorOffset)
  const span = findCompletionSpan(statement.text, statement.cursorOffset, statement.start)
  const insertContext = getInsertContext(statement.text, statement.cursorOffset)
  const usedColumns = insertContext?.usedColumns ?? []
  const scope = getActiveQueryScope(statement.text, statement.cursorOffset)
  const sqlCasePreference = inferSqlCasePreference(beforeCursor, span.token)
  const keywordFollowUps = getKeywordFollowUpOptions(beforeCursor)
  if (!insertContext && span.token && keywordFollowUps.length > 0) {
    const items: RankedItem[] = []
    addKeywordItems(items, keywordFollowUps, 0, sqlCasePreference)
    const filtered = sortItems(span.token, items)
      .filter((item) => !isNoOpCompletion(statement.text, statement.cursorOffset, item))
      .slice(0, 50)
    if (filtered.length === 0) {
      return undefined
    }
    return {
      replace: docCharRange(span.replaceStart, span.replaceEnd),
      items: filtered,
    }
  }
  const postRelationKeywords = getPostRelationKeywordOptions(beforeCursor, clause, input.dialect)
  const updateSetKeywords = getUpdateSetKeywordOptions(beforeCursor)
  const arbitraryIdentifierSlot = span.mode === "word" ? getArbitraryIdentifierSlot(beforeCursor) : undefined
  const arbitraryIdentifierKeywords = clause === "into" ? updateSetKeywords : postRelationKeywords
  if (arbitraryIdentifierSlot?.kind === "after-as") {
    return undefined
  }
  if (
    arbitraryIdentifierSlot?.kind === "after-relation" &&
    (arbitraryIdentifierSlot.token.length < 2 ||
      matchKeywordPrefix(arbitraryIdentifierKeywords, arbitraryIdentifierSlot.token, sqlCasePreference).length === 0)
  ) {
    return undefined
  }
  if (!shouldOpenImplicit(beforeCursor, span.token, span.mode)) {
    return undefined
  }

  const refs = extractTableRefs(scope.text)
  const aliases = buildAliasMap(refs)
  const tempRelations = getTempTableNames(input.text, input.cursorOffset, input.dialect).map((name) => ({
    id: `temp:${name}`,
    name,
    kind: "table" as const,
    fullName: name,
    columns: [],
    source: "temp" as const,
  }))
  const projectionCache = new Map<string, SqlRelation["columns"]>()
  const activeQueries = new Set<string>()
  const cteRelations = buildCteRelationMap(
    scope.visibleCtes,
    input.schema,
    tempRelations,
    new Map(),
    projectionCache,
    activeQueries,
  )
  const ctes = Array.from(cteRelations.values()).map((item) => item.name)
  const relations = resolveReferencedRelations(
    input.schema,
    scope.text,
    tempRelations,
    cteRelations,
    projectionCache,
    activeQueries,
  )
  const scopedRelations = resolveScopedCompletionRelations(
    input.schema,
    refs,
    scope.text,
    tempRelations,
    cteRelations,
    projectionCache,
    activeQueries,
  )
  const outerScopedRelations = scope.outerTexts.flatMap((text) =>
    resolveScopedCompletionRelations(
      input.schema,
      extractTableRefs(text).filter((ref) => Boolean(ref.alias)),
      text,
      tempRelations,
      cteRelations,
      projectionCache,
      activeQueries,
    ),
  )
  const allScopedRelations = [...scopedRelations]
  for (const relation of outerScopedRelations) {
    if (
      allScopedRelations.some(
        (item) =>
          item.relation.id === relation.relation.id && normalize(item.qualifier) === normalize(relation.qualifier),
      )
    ) {
      continue
    }
    allScopedRelations.push(relation)
  }
  if (shouldSuppressExactScopedQualifier(span.token, span.mode, clause, allScopedRelations)) {
    return undefined
  }
  const queryColumns =
    clause === "group" || clause === "order"
      ? inferQueryColumns(scope.text, input.schema, tempRelations, cteRelations, projectionCache, activeQueries)
      : []
  const existsOpen = isExistsQueryStartContext(beforeCursor, span.token)
  const clauseFollowUps = getClauseFollowUpOptions(beforeCursor, clause)
  const selectFollowUps = clause === "select" ? getSelectFollowUpOptions(beforeCursor) : []
  const clauseFollowUpsOnly = shouldShowClauseFollowUpsOnly(beforeCursor, clause, span.token, clauseFollowUps)
  const exactClauseFollowUp = clauseFollowUps.some((keyword) => normalize(keyword) === normalize(span.token))
  const useUnfilteredRelationFallback =
    expectsTableSuggestions(clause) &&
    (EXACT_COMPLETED_KEYWORDS.has(normalize(span.token)) ||
      input.dialect.keywords.some((keyword) => normalize(keyword) === normalize(span.token)))
  if (shouldSuppressExactKeyword(span.token, span.mode, clause, input.dialect) && !exactClauseFollowUp) {
    return undefined
  }
  const items: RankedItem[] = []

  if (span.mode === "member" && span.scopeName) {
    const scopedRelation = resolveScopedRelation(
      span.scopeName,
      relations,
      aliases,
      input.schema,
      tempRelations,
      cteRelations,
      allScopedRelations,
    )
    if (scopedRelation) {
      addColumnItems(items, [scopedRelation], 0)
    }

    if (items.length === 0 && input.dialect.supportsSchemas && expectsTableSuggestions(clause)) {
      addRelationItems(items, input.schema.findRelationsInSchema(span.scopeName), 0)
    }
  }

  if (span.mode === "member" && items.length === 0) {
    return undefined
  }

  if (items.length === 0 && insertContext?.mode === "columns") {
    const target = resolveRelation(input.schema, insertContext.target)
    if (target) {
      addColumnItems(items, [target], 0)
    }
  }

  if (items.length === 0 && insertContext?.mode === "keywords") {
    addKeywordItems(
      items,
      matchKeywordPrefix(INSERT_FOLLOW_UP_KEYWORDS, span.token, sqlCasePreference),
      0,
      sqlCasePreference,
    )
  }

  if (!insertContext && items.length === 0 && updateSetKeywords.length > 0) {
    addKeywordItems(items, updateSetKeywords, 0, sqlCasePreference)
  }

  if (!insertContext && items.length === 0 && existsOpen) {
    addKeywordItems(items, ["SELECT", "WITH"], 0, sqlCasePreference)
  }

  if (!insertContext && items.length === 0 && expectsTableSuggestions(clause)) {
    if (postRelationKeywords.length > 0) {
      addKeywordItems(items, postRelationKeywords, 0, sqlCasePreference)
    }
    if (postRelationKeywords.length === 0) {
      addCteItems(items, ctes, 0)
      addRelationItems(items, tempRelations, 1)
      addRelationItems(items, input.schema.relations, 2)
    }
  }

  if (!insertContext && items.length === 0 && clause === "select") {
    if (shouldPreferFrom(beforeCursor, span.token)) {
      addKeywordItems(items, ["FROM"], 0, sqlCasePreference)
    }

    if (items.length === 0 && selectFollowUps.length > 0) {
      addKeywordItems(items, selectFollowUps, 0, sqlCasePreference)
    }

    if (items.length === 0) {
      addKeywordItems(
        items,
        matchKeywordPrefix(SELECT_CLAUSE_KEYWORDS, span.token, sqlCasePreference),
        0,
        sqlCasePreference,
      )
      if (span.token) {
        addScopedRelationItems(items, allScopedRelations, 1)
      }
      addScopedColumnItems(items, scopedRelations, 2)
      addFunctionItems(items, input.dialect, 3, sqlCasePreference)
    }
  }

  if (!insertContext && items.length === 0 && ["where", "having", "on", "set"].includes(clause)) {
    if (clauseFollowUpsOnly) {
      addKeywordItems(items, clauseFollowUps, 0, sqlCasePreference)
    }
    if (items.length > 0) {
      return {
        replace: docCharRange(span.replaceStart, span.replaceEnd),
        items: sortItems(span.token, items)
          .filter((item) => !usedColumns.includes(normalize(item.label)))
          .filter((item) => !isNoOpCompletion(statement.text, statement.cursorOffset, item))
          .slice(0, 50),
      }
    }
    if (span.token) {
      addScopedRelationItems(items, allScopedRelations, 0)
    }
    addScopedColumnItems(items, scopedRelations, 1)
    addKeywordItems(items, clauseFollowUps, 2, sqlCasePreference)
    addOperatorItems(items, input.dialect, 3, sqlCasePreference)
    addKeywordItems(items, EXPRESSION_KEYWORDS, 4, sqlCasePreference)
    addFunctionItems(items, input.dialect, 5, sqlCasePreference)
  }

  if (!insertContext && items.length === 0 && (clause === "group" || clause === "order")) {
    addQueryColumnItems(items, queryColumns, 0)
    if (span.token) {
      addScopedRelationItems(items, allScopedRelations, 1)
    }
    addScopedColumnItems(items, scopedRelations, 2)
    if (clause === "order") {
      addKeywordItems(items, ORDER_DIRECTION_KEYWORDS, 3, sqlCasePreference)
    }
    addKeywordItems(items, clauseFollowUps, 4, sqlCasePreference)
    addFunctionItems(items, input.dialect, 5, sqlCasePreference)
  }

  if (!insertContext && items.length === 0 && expectsColumnSuggestions(clause)) {
    if (span.token) {
      addScopedRelationItems(items, allScopedRelations, 0)
    }
    addScopedColumnItems(items, scopedRelations, 1)
    addFunctionItems(items, input.dialect, 2, sqlCasePreference)
  }

  if (!insertContext && items.length === 0) {
    addKeywordItems(items, input.dialect.keywords, 0, sqlCasePreference)
    addFunctionItems(items, input.dialect, 1, sqlCasePreference)
  }

  const filtered = sortItems(useUnfilteredRelationFallback ? "" : span.token, items)
    .filter((item) => !usedColumns.includes(normalize(item.label)))
    .filter((item) => !isNoOpCompletion(statement.text, statement.cursorOffset, item))
    .slice(0, 50)
  if (filtered.length === 0) {
    return undefined
  }

  return {
    replace: docCharRange(span.replaceStart, span.replaceEnd),
    items: filtered,
  }
}
