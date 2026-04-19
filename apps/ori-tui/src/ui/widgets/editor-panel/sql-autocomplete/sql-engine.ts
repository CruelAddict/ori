import type { BufferAutocompleteItem, BufferAutocompleteResult } from "@ui/components/buffer"
import { docCharRange } from "@ui/components/buffer/buffer-model/coords"
import type { SqlDialect } from "./dialect"
import {
  buildAliasMap,
  extractCteNames,
  extractTableRefs,
  findCompletionSpan,
  findCurrentClause,
  getCurrentSqlStatement,
  getInsertContext,
  getTempTableNames,
  isInsideSuppressedRegion,
  type SqlClause,
} from "./sql-context"
import type { SqlRelation, SqlSchemaIndex } from "./sql-schema-index"

/* LLM-generated, use tests as source of truth for expected behavior */

type RankedItem = BufferAutocompleteItem & {
  sortGroup: number
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

type SqlCasePreference = "lower" | "upper"

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
const FROM_FOLLOWUP_KEYWORDS = ["WHERE", "JOIN", "GROUP BY", "ORDER BY", "LIMIT", "UNION"] as const
const JOIN_FOLLOWUP_KEYWORDS = ["ON", "USING"] as const
const IDENTIFIER = '(?:"(?:[^"]|"")+"|\\[[^\\]]+\\]|`[^`]+`|[A-Za-z_][A-Za-z0-9_$]*)'
const QUALIFIED_IDENTIFIER = `${IDENTIFIER}(?:\\s*\\.\\s*${IDENTIFIER}){0,2}`
const KEYWORD_FOLLOW_UP_PATTERNS = [
  { pattern: /\binsert\s+([A-Za-z_]*)$/i, keywords: ["INTO"] },
  { pattern: /\bdelete\s+([A-Za-z_]*)$/i, keywords: ["FROM"] },
  { pattern: /\bgroup\s+([A-Za-z_]*)$/i, keywords: ["BY"] },
  { pattern: /\border\s+([A-Za-z_]*)$/i, keywords: ["BY"] },
  { pattern: /\b(?:left|right|inner|outer|full|cross)\s+([A-Za-z_]*)$/i, keywords: ["JOIN"] },
] as const
const INSERT_FOLLOW_UP_KEYWORDS = ["VALUES", "SELECT", "DEFAULT VALUES"] as const

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
  const key = `${item.label}:${item.detail ?? ""}:${item.insertText}`
  if (target.some((entry) => `${entry.label}:${entry.detail ?? ""}:${entry.insertText}` === key)) {
    return
  }
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

function sortItems(query: string, items: RankedItem[]) {
  return items
    .map((item) => ({ item, match: scoreMatch(query, item.label) }))
    .filter((entry): entry is { item: RankedItem; match: { tier: number; score: number } } => Boolean(entry.match))
    .sort((a, b) => {
      if (a.item.sortGroup !== b.item.sortGroup) {
        return a.item.sortGroup - b.item.sortGroup
      }
      if (a.match.tier !== b.match.tier) {
        return a.match.tier - b.match.tier
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
      detail: entry.item.detail,
    }))
}

function relationDetail(relation: SqlRelation | TempRelation) {
  const parts: string[] = [relation.kind]
  if ("source" in relation && relation.source === "temp") {
    parts.push("temp")
  }
  if (relation.schema) {
    parts.push(relation.schema)
  }
  return parts.join(" ")
}

function addRelationItems(target: RankedItem[], relations: readonly (SqlRelation | TempRelation)[], sortGroup: number) {
  for (const relation of relations) {
    pushUnique(target, {
      id: relation.id,
      label: relation.name,
      insertText: relation.name,
      detail: relationDetail(relation),
      sortGroup,
    })
  }
}

function addColumnItems(target: RankedItem[], relations: readonly SqlRelation[], sortGroup: number) {
  for (const relation of relations) {
    for (const column of relation.columns) {
      pushUnique(target, {
        id: column.id,
        label: column.name,
        insertText: column.name,
        detail: [relation.name, column.dataType].filter(Boolean).join(" "),
        sortGroup,
      })
    }
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
      detail: "function",
      sortGroup,
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
    const formatted = formatSqlVocabulary(operator, casePreference)
    pushUnique(target, {
      id: `operator:${operator}`,
      label: formatted,
      insertText: formatted,
      detail: "operator",
      sortGroup,
    })
  }
}

function addCteItems(target: RankedItem[], ctes: readonly string[], sortGroup: number) {
  for (const cte of ctes) {
    pushUnique(target, {
      id: `cte:${cte}`,
      label: cte,
      insertText: cte,
      detail: "cte",
      sortGroup,
    })
  }
}

function resolveReferencedRelations(
  schema: SqlSchemaIndex,
  statementText: string,
  tempRelations: readonly TempRelation[],
) {
  const resolved: SqlRelation[] = []

  for (const ref of extractTableRefs(statementText)) {
    const lookupName = ref.schema ? `${ref.schema}.${ref.name}` : ref.name
    const relation = schema.findRelations(lookupName)[0] ?? schema.findRelations(ref.name)[0]
    if (relation) {
      if (resolved.some((item) => item.id === relation.id)) {
        continue
      }
      resolved.push(relation)
      continue
    }

    const temp = tempRelations.find((item) => normalize(item.name) === normalize(ref.name))
    if (!temp) {
    }
  }

  return resolved
}

function resolveRelation(schema: SqlSchemaIndex, ref: { schema?: string; name: string }) {
  return (
    schema.findRelations(ref.schema ? `${ref.schema}.${ref.name}` : ref.name)[0] ?? schema.findRelations(ref.name)[0]
  )
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

function hasStructuralTrigger(beforeCursor: string) {
  const last = beforeCursor.at(-1)
  if (last !== " " && last !== "\t" && last !== "\n") {
    return false
  }

  const previous = beforeCursor
    .slice(0, -1)
    .match(/([A-Za-z_][A-Za-z0-9_$]*)\s*$/)?.[1]
    ?.toLowerCase()
  if (!previous) {
    return false
  }

  return STRUCTURAL_KEYWORDS.has(previous)
}

function getPostRelationKeywordOptions(beforeCursor: string, clause: SqlClause) {
  if (clause !== "from" && clause !== "join") {
    return []
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

  if (clause === "join") {
    return [...JOIN_FOLLOWUP_KEYWORDS]
  }
  return [...FROM_FOLLOWUP_KEYWORDS]
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

function shouldPreferFrom(beforeCursor: string, token: string) {
  const matchesSelectStar = /\bSELECT\s+\*\s+\w*$/i.test(beforeCursor) || /\bSELECT\s+\*\s*$/i.test(beforeCursor)
  if (!matchesSelectStar) {
    return false
  }

  return !token || "from".startsWith(token.toLowerCase())
}

function shouldOpenImplicit(beforeCursor: string, token: string, mode: "word" | "member") {
  if (mode === "member") {
    return true
  }
  if (token.length > 0) {
    return true
  }
  return hasStructuralTrigger(beforeCursor)
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
  const sqlCasePreference = inferSqlCasePreference(beforeCursor, span.token)
  if (!shouldOpenImplicit(beforeCursor, span.token, span.mode) && !insertContext) {
    return undefined
  }

  const refs = extractTableRefs(statement.text)
  const aliases = buildAliasMap(refs)
  const ctes = extractCteNames(statement.text)
  const tempRelations = getTempTableNames(input.text, input.cursorOffset, input.dialect).map((name) => ({
    id: `temp:${name}`,
    name,
    kind: "table" as const,
    fullName: name,
    columns: [],
    source: "temp" as const,
  }))
  const relations = resolveReferencedRelations(input.schema, statement.text, tempRelations)
  const postRelationKeywords = getPostRelationKeywordOptions(beforeCursor, clause)
  const keywordFollowUps = getKeywordFollowUpOptions(beforeCursor)
  const items: RankedItem[] = []

  if (span.mode === "member" && span.scopeName) {
    const alias = aliases.get(span.scopeName.toLowerCase())
    let scopedRelation = alias
      ? (input.schema.findRelations(alias.schema ? `${alias.schema}.${alias.name}` : alias.name)[0] ??
        input.schema.findRelations(alias.name)[0])
      : undefined
    if (!scopedRelation) {
      scopedRelation = input.schema.findRelations(span.scopeName)[0]
    }
    if (scopedRelation) {
      addColumnItems(items, [scopedRelation], 0)
    }

    if (items.length === 0 && input.dialect.supportsSchemas) {
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

  if (!insertContext && items.length === 0 && keywordFollowUps.length > 0) {
    addKeywordItems(items, keywordFollowUps, 0, sqlCasePreference)
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

    if (items.length === 0) {
      addKeywordItems(items, SELECT_CLAUSE_KEYWORDS, 0, sqlCasePreference)
      addColumnItems(items, relations, 1)
      addFunctionItems(items, input.dialect, 2, sqlCasePreference)
    }
  }

  if (!insertContext && items.length === 0 && ["where", "having", "on", "set"].includes(clause)) {
    addColumnItems(items, relations, 0)
    addOperatorItems(items, input.dialect, 1, sqlCasePreference)
    addKeywordItems(items, EXPRESSION_KEYWORDS, 2, sqlCasePreference)
    addFunctionItems(items, input.dialect, 3, sqlCasePreference)
  }

  if (!insertContext && items.length === 0 && (clause === "group" || clause === "order")) {
    addColumnItems(items, relations, 0)
    if (clause === "order") {
      addKeywordItems(items, ORDER_DIRECTION_KEYWORDS, 1, sqlCasePreference)
    }
    addFunctionItems(items, input.dialect, 2, sqlCasePreference)
  }

  if (!insertContext && items.length === 0 && expectsColumnSuggestions(clause)) {
    addColumnItems(items, relations, 0)
    addFunctionItems(items, input.dialect, 1, sqlCasePreference)
  }

  if (!insertContext && items.length === 0) {
    addKeywordItems(items, input.dialect.keywords, 0, sqlCasePreference)
    addFunctionItems(items, input.dialect, 1, sqlCasePreference)
    addRelationItems(items, tempRelations, 2)
    addRelationItems(items, input.schema.relations, 3)
  }

  const filtered = sortItems(span.token, items)
    .filter((item) => !insertContext?.usedColumns.includes(normalize(item.label)))
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
