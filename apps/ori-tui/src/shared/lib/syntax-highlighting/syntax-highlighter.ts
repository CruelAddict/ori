import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { addDefaultParsers, getTreeSitterClient, RGBA, SyntaxStyle } from "@opentui/core"
import type { Logger } from "pino"
import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js"
import sqlHighlights from "../../../assets/highlights.scm" with { type: "file" }
import sqlWasm from "../../../assets/tree-sitter-sql.wasm" with { type: "file" }

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

const FILETYPE_SQL = "sql"
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

async function collectSqlHighlights(text: string, styleIds: StyleIds, logger?: Logger): Promise<SyntaxHighlightSpan[]> {
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

async function collectHighlightsByLanguage(
  text: string,
  language: string,
  styleIds: StyleIds,
  logger?: Logger,
): Promise<SyntaxHighlightSpan[]> {
  if (language === FILETYPE_SQL) {
    return collectSqlHighlights(text, styleIds, logger)
  }
  logger?.warn({ language }, "syntax-highlighter: unsupported language, returning no highlights")
  return []
}

export function syntaxHighlighter(params: { theme: Accessor<SyntaxThemePalette>; language: string; logger?: Logger }) {
  const { theme, language, logger } = params
  let disposed = false
  let currentStyle = buildSyntaxStyle(theme())
  let lastRequest: HighlightRequest | null = null
  let requestToken = 0

  const [highlightResult, setHighlightResult] = createSignal<SyntaxHighlightResult>({
    version: 0,
    syntaxStyle: currentStyle.syntaxStyle,
    spans: [],
  })

  const runHighlight = async (request: HighlightRequest, style: SyntaxStyleBundle) => {
    const token = ++requestToken
    try {
      const spans = await collectHighlightsByLanguage(request.text, language, style.styleIds, logger)
      if (disposed || token !== requestToken) {
        return
      }
      setHighlightResult({
        version: request.version,
        syntaxStyle: style.syntaxStyle,
        spans,
      })
    } catch (err) {
      if (disposed || token !== requestToken) {
        return
      }
      logger?.error({ err }, "syntax-highlighter: highlight parse failed")
      setHighlightResult({
        version: request.version,
        syntaxStyle: style.syntaxStyle,
        spans: [],
      })
    }
  }

  const scheduleHighlight = (text: string, version: number | string) => {
    const request = { text, version } as HighlightRequest
    lastRequest = request
    void runHighlight(request, currentStyle)
  }

  createEffect(() => {
    const palette = theme()
    const nextStyle = buildSyntaxStyle(palette)
    const prevStyle = currentStyle
    currentStyle = nextStyle
    prevStyle.syntaxStyle.destroy()

    if (lastRequest) {
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
    currentStyle.syntaxStyle.destroy()
  }

  onCleanup(dispose)

  return {
    scheduleHighlight,
    highlightResult,
    dispose,
  }
}
