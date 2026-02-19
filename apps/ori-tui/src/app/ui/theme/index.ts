import kanagawaDragon from "./kanagawa-dragon.json" with { type: "json" }
import kanagawaLotus from "./kanagawa-lotus.json" with { type: "json" }
import kanagawaWave from "./kanagawa-wave.json" with { type: "json" }
import oriDark from "./ori-dark.json" with { type: "json" }
import oriLight from "./ori-light.json" with { type: "json" }

type PaletteTheme = {
  primary: string
  secondary: string
  accent: string
  text: string
  textMuted: string
  border: string
  warning: string
  error: string
  success: string
  info: string
  bg_0: string
  bg_1: string
  bg_2: string
  bg_3: string
  textEmphasis: string
}

type PaletteToken = keyof PaletteTheme
type Palette = Record<PaletteToken, HexColor>

type HexColor = `#${string}`
type RefName = string
type ColorValue = HexColor | RefName

export const HIGHLIGHT_GROUPS = [
  "text",
  "text_muted",
  "background",
  "panel_background",
  "element_background",
  "border",
  "primary",
  "secondary",
  "accent",
  "warning",
  "error",
  "success",
  "info",
  "header",
  "selection_background",
  "selection_foreground",
  "scrollbar_foreground",
  "scrollbar_background",
  "app_background",
  "overlay_scrim_base",
  "editor_background",
  "editor_active_line_background",
  "editor_text",
  "editor_cursor",
  "results_header_background",
  "results_row_alt_background",
  "results_selection_background",
  "results_column_title",
  "results_row_number",
  "results_row_number_cursor",
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

export type HighlightGroup = (typeof HIGHLIGHT_GROUPS)[number]

export type Theme = {
  get: (group: HighlightGroup) => string
}

const PALETTE_TOKENS = [
  "primary",
  "secondary",
  "accent",
  "text",
  "textMuted",
  "border",
  "warning",
  "error",
  "success",
  "info",
  "bg_0",
  "bg_1",
  "bg_2",
  "bg_3",
  "textEmphasis",
] as const satisfies readonly PaletteToken[]

type HighlightDefault =
  | {
    type: "palette"
    token: PaletteToken
  }
  | {
    type: "group"
    group: HighlightGroup
  }

const p = (token: PaletteToken): HighlightDefault => ({ type: "palette", token })
const g = (group: HighlightGroup): HighlightDefault => ({ type: "group", group })

const DEFAULT_HIGHLIGHT_LINKS = {
  text: p("text"),
  text_muted: p("textMuted"),
  background: p("bg_0"),
  panel_background: p("bg_0"),
  element_background: p("bg_2"),
  border: p("border"),
  primary: p("primary"),
  secondary: p("secondary"),
  accent: p("accent"),
  warning: p("warning"),
  error: p("error"),
  success: p("success"),
  info: p("info"),
  header: g("accent"),
  selection_background: g("primary"),
  selection_foreground: g("background"),
  scrollbar_foreground: g("text"),
  scrollbar_background: g("panel_background"),
  app_background: g("panel_background"),
  overlay_scrim_base: g("background"),
  editor_background: p("bg_1"),
  editor_active_line_background: p("bg_2"),
  editor_text: p("textEmphasis"),
  editor_cursor: g("primary"),
  results_header_background: p("bg_3"),
  results_row_alt_background: p("bg_2"),
  results_selection_background: g("results_header_background"),
  results_column_title: g("header"),
  results_row_number: g("text_muted"),
  results_row_number_cursor: g("primary"),
  syntax_keyword: g("primary"),
  syntax_keyword_operator: g("syntax_keyword"),
  syntax_string: g("accent"),
  syntax_number: g("info"),
  syntax_float: g("syntax_number"),
  syntax_boolean: g("syntax_number"),
  syntax_comment: g("text_muted"),
  syntax_identifier: g("text"),
  syntax_function_call: g("syntax_identifier"),
  syntax_variable: g("syntax_identifier"),
  syntax_field: g("syntax_identifier"),
  syntax_parameter: g("syntax_identifier"),
  syntax_attribute: g("syntax_identifier"),
  syntax_storageclass: g("syntax_identifier"),
  syntax_conditional: g("syntax_identifier"),
  syntax_type: g("syntax_identifier"),
  syntax_type_qualifier: g("syntax_type"),
  syntax_type_builtin: g("syntax_type"),
  syntax_operator: g("secondary"),
  syntax_punctuation_bracket: g("syntax_identifier"),
  syntax_punctuation_delimiter: g("syntax_identifier"),
} as const satisfies Record<HighlightGroup, HighlightDefault>

const HIGHLIGHT_GROUP_SET = new Set<string>(HIGHLIGHT_GROUPS)

export type ThemeConfig = {
  $schema?: string
  defs?: Record<string, ColorValue>
  theme: Record<string, ColorValue>
  highlights?: Partial<Record<HighlightGroup, ColorValue>>
}

type ThemeDefinition = {
  label: string
  data: ThemeConfig
}

export const THEME_DEFINITIONS = {
  "ori-dark": { label: "Ori Dark", data: oriDark },
  "ori-light": { label: "Ori Light", data: oriLight },
  "kanagawa-wave": { label: "Kanagawa Wave", data: kanagawaWave },
  "kanagawa-lotus": { label: "Kanagawa Lotus", data: kanagawaLotus },
  "kanagawa-dragon": { label: "Kanagawa Dragon", data: kanagawaDragon },
} as const satisfies Record<string, ThemeDefinition>

export type ThemeName = keyof typeof THEME_DEFINITIONS
export const DEFAULT_THEME_NAME: ThemeName = "ori-dark"

export const THEME_OPTIONS = Object.entries(THEME_DEFINITIONS).map(([name, entry]) => ({
  name: name as ThemeName,
  label: entry.label,
}))

export function resolveTheme(name: string | undefined): Theme {
  const normalized = normalizeThemeName(name) ?? DEFAULT_THEME_NAME
  const definition = THEME_DEFINITIONS[normalized]
  return resolveThemeDefinition(definition.data)
}

export function normalizeThemeName(name?: string | null): ThemeName | undefined {
  if (!name) {
    return undefined
  }
  const key = name.toLowerCase()
  const match = Object.keys(THEME_DEFINITIONS).find((candidate) => candidate === key)
  return match as ThemeName | undefined
}

export function resolveThemeDefinition(theme: ThemeConfig): Theme {
  const defs = theme.defs ?? {}

  const resolveDefsColor = (value: ColorValue, chain: string[] = []): HexColor => {
    if (value.startsWith("#")) {
      return value as HexColor
    }
    if (chain.includes(value)) {
      throw new Error(`Circular theme color reference: ${chain.join(" -> ")} -> ${value}`)
    }
    const ref = defs[value]
    if (!ref) {
      throw new Error(`Unknown theme color reference: ${value}`)
    }
    return resolveDefsColor(ref, [...chain, value])
  }

  const pal = PALETTE_TOKENS.reduce((acc, token) => {
    const value = theme.theme[token]
    if (!value) {
      throw new Error(`Missing theme color key: ${token}`)
    }
    acc[token] = resolveDefsColor(value)
    return acc
  }, {} as Palette)

  const ov = theme.highlights ?? {}
  const cache = new Map<HighlightGroup, HexColor>()

  const resolveOverrideColor = (value: ColorValue, chain: string[]): HexColor => {
    if (value.startsWith("#")) {
      return value as HexColor
    }
    if (chain.includes(value)) {
      throw new Error(`Circular theme color reference: ${chain.join(" -> ")} -> ${value}`)
    }
    if (HIGHLIGHT_GROUP_SET.has(value)) {
      return resolveHighlight(value as HighlightGroup, chain)
    }
    return resolveDefsColor(value, chain)
  }

  const resolveHighlight = (group: HighlightGroup, chain: string[] = []): HexColor => {
    if (chain.includes(group)) {
      throw new Error(`Circular theme color reference: ${chain.join(" -> ")} -> ${group}`)
    }

    const cached = cache.get(group)
    if (cached) {
      return cached
    }

    const nextChain = [...chain, group]
    const override = ov[group]
    if (override) {
      const resolved = resolveOverrideColor(override, nextChain)
      cache.set(group, resolved)
      return resolved
    }

    const fallback = DEFAULT_HIGHLIGHT_LINKS[group]
    if (fallback.type === "palette") {
      const resolved = pal[fallback.token]
      cache.set(group, resolved)
      return resolved
    }

    const resolved = resolveHighlight(fallback.group, nextChain)
    cache.set(group, resolved)
    return resolved
  }

  const resolved = Object.fromEntries(HIGHLIGHT_GROUPS.map((group) => [group, resolveHighlight(group)])) as Record<
    HighlightGroup,
    HexColor
  >

  return {
    get: (group: HighlightGroup) => resolved[group],
  }
}
