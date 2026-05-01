import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { addDefaultParsers, getTreeSitterClient, RGBA, SyntaxStyle } from "@opentui/core"
import { debounce } from "@utils/debounce"
import { buildLineStarts } from "@utils/line-offsets"
import type { Logger } from "pino"
import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js"
import sqlHighlights from "../assets/highlights.scm" with { type: "file" }
import sqlWasm from "../assets/tree-sitter-sql.wasm" with { type: "file" }
import { collectSqlQueries } from "../ui/widgets/editor-panel/sql-statement-detector"

type SyntaxThemePalette = {
  get(group: string): string
}

export type SyntaxHighlightSpan = {
  start: number
  end: number
  styleId: number
}

export type SyntaxHighlightResult = {
  version: number | string
  syntaxStyle: SyntaxStyle
  spans: SyntaxHighlightSpan[]
}

const SYNTAX_HIGHLIGHT_GROUPS = [
  "syntax_keyword",
  "syntax_keyword_operator",
  "syntax_string",
  "syntax_number",
  "syntax_float",
  "syntax_boolean",
  "syntax_comment",
  "syntax_identifier",
  "syntax_function_call",
  "syntax_variable",
  "syntax_field",
  "syntax_parameter",
  "syntax_attribute",
  "syntax_storageclass",
  "syntax_conditional",
  "syntax_type",
  "syntax_type_qualifier",
  "syntax_type_builtin",
  "syntax_operator",
  "syntax_punctuation_bracket",
  "syntax_punctuation_delimiter",
] as const

type SyntaxHighlightGroup = (typeof SYNTAX_HIGHLIGHT_GROUPS)[number]

type StyleIds = Record<SyntaxHighlightGroup, number>

type SyntaxStyleBundle = {
  syntaxStyle: SyntaxStyle
  styleIds: StyleIds
}

type HighlightRequest = {
  text: string
  version: number | string
}

type CachedSqlStatement = {
  text: string
  start: number
  spans: SyntaxHighlightSpan[]
}

type SqlHighlightSnapshot = {
  statements: CachedSqlStatement[]
}

type HighlightPassResult = {
  spans: SyntaxHighlightSpan[]
  snapshot?: SqlHighlightSnapshot
}

const FILETYPE_SQL = "sql"
const HIGHLIGHT_DEBOUNCE_MS = 75
const ASSET_BASE = dirname(fileURLToPath(import.meta.url))
const SQL_WASM_PATH = resolve(ASSET_BASE, sqlWasm)
const SQL_HIGHLIGHTS_URL = resolve(ASSET_BASE, sqlHighlights)
const SQL_ASSET_LOG = { wasm: SQL_WASM_PATH, highlights: SQL_HIGHLIGHTS_URL }
const SQL_PARSER = {
  filetype: FILETYPE_SQL,
  wasm: SQL_WASM_PATH,
  queries: { highlights: [SQL_HIGHLIGHTS_URL] },
}

let registerPromise: Promise<void> | null = null

async function ensureSqlRegistered(logger?: Logger) {
  if (!registerPromise) {
    registerPromise = (async () => {
      addDefaultParsers([SQL_PARSER])
      const client = getTreeSitterClient()
      try {
        await client.initialize?.()
      } catch (err) {
        logger?.warn({ err }, "syntax-highlighter: client initialize failed, continuing")
      }
      logger?.warn({ assets: SQL_ASSET_LOG }, "syntax-highlighter: register default parser assets")
      try {
        await client.preloadParser?.(FILETYPE_SQL)
      } catch (err) {
        logger?.warn({ err }, "syntax-highlighter: preload parser failed")
      }
    })().catch((err) => {
      registerPromise = null
      throw err
    })
  }
  return registerPromise
}

function buildSyntaxStyle(theme: SyntaxThemePalette): SyntaxStyleBundle {
  const syntaxStyle = SyntaxStyle.create()
  const styleIds = {} as StyleIds

  for (const group of SYNTAX_HIGHLIGHT_GROUPS) {
    const styleKey = `syntax.${group}`
    syntaxStyle.registerStyle(styleKey, { fg: RGBA.fromHex(theme.get(group)) })
    styleIds[group] = syntaxStyle.getStyleId(styleKey) ?? 0
  }

  return {
    syntaxStyle,
    styleIds,
  }
}

function mapGroupToStyleId(group: string, styleIds: StyleIds): number | null {
  switch (group) {
    case "keyword":
      return styleIds.syntax_keyword
    case "keyword.operator":
      return styleIds.syntax_keyword_operator
    case "string":
      return styleIds.syntax_string
    case "comment":
      return styleIds.syntax_comment
    case "number":
      return styleIds.syntax_number
    case "float":
      return styleIds.syntax_float
    case "boolean":
      return styleIds.syntax_boolean
    case "operator":
      return styleIds.syntax_operator
    case "function.call":
      return styleIds.syntax_function_call
    case "variable":
      return styleIds.syntax_variable
    case "field":
      return styleIds.syntax_field
    case "parameter":
      return styleIds.syntax_parameter
    case "attribute":
      return styleIds.syntax_attribute
    case "storageclass":
      return styleIds.syntax_storageclass
    case "conditional":
      return styleIds.syntax_conditional
    case "type":
      return styleIds.syntax_type
    case "type.qualifier":
      return styleIds.syntax_type_qualifier
    case "type.builtin":
      return styleIds.syntax_type_builtin
    case "punctuation.bracket":
      return styleIds.syntax_punctuation_bracket
    case "punctuation.delimiter":
      return styleIds.syntax_punctuation_delimiter
    default:
      return null
  }
}

async function highlightSqlText(text: string, styleIds: StyleIds, logger?: Logger): Promise<SyntaxHighlightSpan[]> {
  await ensureSqlRegistered(logger)
  const client = getTreeSitterClient()
  const result = (await client.highlightOnce(text, FILETYPE_SQL)) as {
    highlights?: [startIndex: number, endIndex: number, group: string][]
    warning?: string
    error?: string
  }

  if (result.error) {
    logger?.error({ error: result.error }, "syntax-highlighter: highlightOnce returned issue")
    return []
  }
  if (result.warning) {
    logger?.warn({ warning: result.warning }, "syntax-highlighter: highlightOnce returned issue")
  }

  const highlights = result.highlights ?? []
  const spans: SyntaxHighlightSpan[] = []

  for (const [startIndex, endIndex, group] of highlights) {
    const styleId = mapGroupToStyleId(String(group), styleIds)
    if (styleId == null) {
      continue
    }
    spans.push({ start: startIndex, end: endIndex, styleId })
  }

  return spans
}

function collectSqlStatements(text: string) {
  return collectSqlQueries(text, buildLineStarts(text)).map((statement) => ({
    start: statement.start,
    end: statement.end,
    text: text.slice(statement.start, statement.end),
  }))
}

function flattenSqlStatements(statements: readonly CachedSqlStatement[]) {
  const spans: SyntaxHighlightSpan[] = []
  for (const statement of statements) {
    for (const span of statement.spans) {
      spans.push({
        start: span.start + statement.start,
        end: span.end + statement.start,
        styleId: span.styleId,
      })
    }
  }
  return spans
}

function stableSqlPrefixCount(previous: readonly CachedSqlStatement[], next: ReturnType<typeof collectSqlStatements>) {
  let count = 0
  for (; count < previous.length && count < next.length; count += 1) {
    if (previous[count]?.text !== next[count]?.text) {
      break
    }
  }
  return count
}

function stableSqlSuffixCount(
  previous: readonly CachedSqlStatement[],
  next: ReturnType<typeof collectSqlStatements>,
  prefix: number,
) {
  let count = 0
  for (; count < previous.length - prefix && count < next.length - prefix; count += 1) {
    const previousIndex = previous.length - 1 - count
    const nextIndex = next.length - 1 - count
    if (previous[previousIndex]?.text !== next[nextIndex]?.text) {
      break
    }
  }
  return count
}

async function highlightSqlStatement(statementText: string, start: number, styleIds: StyleIds, logger?: Logger) {
  return {
    text: statementText,
    start,
    spans: await highlightSqlText(statementText, styleIds, logger),
  } satisfies CachedSqlStatement
}

async function collectSqlHighlights(
  text: string,
  styleIds: StyleIds,
  previous: SqlHighlightSnapshot | undefined,
  logger?: Logger,
): Promise<HighlightPassResult> {
  const statements = collectSqlStatements(text)
  if (statements.length === 0) {
    return {
      spans: [],
      snapshot: { statements: [] },
    }
  }

  if (!previous) {
    const highlighted: CachedSqlStatement[] = []
    for (const statement of statements) {
      highlighted.push(await highlightSqlStatement(statement.text, statement.start, styleIds, logger))
    }
    return {
      spans: flattenSqlStatements(highlighted),
      snapshot: { statements: highlighted },
    }
  }

  const prefix = stableSqlPrefixCount(previous.statements, statements)
  const suffix = stableSqlSuffixCount(previous.statements, statements, prefix)
  const highlighted: CachedSqlStatement[] = []

  for (let index = 0; index < prefix; index += 1) {
    const cached = previous.statements[index]
    const statement = statements[index]
    if (!cached || !statement) {
      continue
    }
    highlighted.push({
      text: statement.text,
      start: statement.start,
      spans: cached.spans,
    })
  }

  for (let index = prefix; index < statements.length - suffix; index += 1) {
    const statement = statements[index]
    if (!statement) {
      continue
    }
    highlighted.push(await highlightSqlStatement(statement.text, statement.start, styleIds, logger))
  }

  for (let offset = suffix; offset > 0; offset -= 1) {
    const previousIndex = previous.statements.length - offset
    const nextIndex = statements.length - offset
    const cached = previous.statements[previousIndex]
    const statement = statements[nextIndex]
    if (!cached || !statement) {
      continue
    }
    highlighted.push({
      text: statement.text,
      start: statement.start,
      spans: cached.spans,
    })
  }

  return {
    spans: flattenSqlStatements(highlighted),
    snapshot: { statements: highlighted },
  }
}

async function collectHighlightsByLanguage(
  text: string,
  language: string,
  styleIds: StyleIds,
  previous: SqlHighlightSnapshot | undefined,
  logger?: Logger,
): Promise<HighlightPassResult> {
  if (language === FILETYPE_SQL) {
    return collectSqlHighlights(text, styleIds, previous, logger)
  }
  logger?.warn({ language }, "syntax-highlighter: unsupported language, returning no highlights")
  return { spans: [] }
}

export function syntaxHighlighter(params: { theme: Accessor<SyntaxThemePalette>; language: string; logger?: Logger }) {
  const { theme, language, logger } = params
  let disposed = false
  let currentStyle = buildSyntaxStyle(theme())
  let lastRequest: HighlightRequest | null = null
  let requestToken = 0
  let sqlSnapshot: SqlHighlightSnapshot | undefined

  const [highlightResult, setHighlightResult] = createSignal<SyntaxHighlightResult>({
    version: 0,
    syntaxStyle: currentStyle.syntaxStyle,
    spans: [],
  })

  const runHighlight = async (request: HighlightRequest, style: SyntaxStyleBundle) => {
    const token = ++requestToken
    try {
      const result = await collectHighlightsByLanguage(request.text, language, style.styleIds, sqlSnapshot, logger)
      if (disposed || token !== requestToken) {
        return
      }
      sqlSnapshot = result.snapshot
      setHighlightResult({
        version: request.version,
        syntaxStyle: style.syntaxStyle,
        spans: result.spans,
      })
    } catch (err) {
      if (disposed || token !== requestToken) {
        return
      }
      sqlSnapshot = undefined
      logger?.error({ err }, "syntax-highlighter: highlight parse failed")
      setHighlightResult({
        version: request.version,
        syntaxStyle: style.syntaxStyle,
        spans: [],
      })
    }
  }

  const flushHighlight = debounce(() => {
    if (!lastRequest) {
      return
    }
    void runHighlight(lastRequest, currentStyle)
  }, HIGHLIGHT_DEBOUNCE_MS)

  const scheduleHighlight = (text: string, version: number | string) => {
    lastRequest = { text, version }
    flushHighlight()
  }

  createEffect(() => {
    const palette = theme()
    const nextStyle = buildSyntaxStyle(palette)
    const prevStyle = currentStyle
    currentStyle = nextStyle
    sqlSnapshot = undefined
    prevStyle.syntaxStyle.destroy()

    if (lastRequest) {
      flushHighlight.clear()
      void runHighlight(lastRequest, currentStyle)
    } else {
      setHighlightResult((prev) => ({
        version: prev.version,
        syntaxStyle: currentStyle.syntaxStyle,
        spans: prev.spans,
      }))
    }
  })

  const dispose = () => {
    if (disposed) {
      return
    }
    disposed = true
    flushHighlight.clear()
    currentStyle.syntaxStyle.destroy()
  }

  onCleanup(dispose)

  return {
    scheduleHighlight,
    highlightResult,
    dispose,
  }
}
