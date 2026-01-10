import {
  DEFAULT_THEME_NAME,
  normalizeThemeName,
  resolveTheme,
  THEME_OPTIONS,
  type Theme,
  type ThemeName,
} from "@app/theme"
import { readStoredTheme, writeStoredTheme } from "@app/theme/storage"
import { type Accessor, createContext, createMemo, createSignal, type JSX, useContext } from "solid-js"

type ThemeContextValue = {
  theme: Accessor<Theme>
  availableThemes: { name: ThemeName; label: string }[]
  selectedTheme: Accessor<ThemeName>
  setTheme: (name: string) => void
}

const ThemeContext = createContext<ThemeContextValue>()

export type ThemeProviderProps = {
  children: JSX.Element
  defaultTheme?: string
}

export function ThemeProvider(props: ThemeProviderProps) {
  const storedTheme = readStoredTheme()
  const normalizedStored = normalizeThemeName(storedTheme)
  const normalizedDefault = normalizeThemeName(props.defaultTheme)
  const initial = normalizedDefault ?? normalizedStored ?? DEFAULT_THEME_NAME

  const [selectedTheme, setSelectedTheme] = createSignal<ThemeName>(initial)

  const theme = createMemo(() => resolveTheme(selectedTheme()))

  const setTheme = (name: string) => {
    const normalized = normalizeThemeName(name)
    if (!normalized) {
      return
    }
    setSelectedTheme(normalized)
    writeStoredTheme(normalized)
  }

  const value: ThemeContextValue = {
    theme,
    availableThemes: THEME_OPTIONS,
    selectedTheme,
    setTheme,
  }

  return <ThemeContext.Provider value={value}>{props.children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    throw new Error("ThemeProvider is missing in component tree")
  }
  return ctx
}
