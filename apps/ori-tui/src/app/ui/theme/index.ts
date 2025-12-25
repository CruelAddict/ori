import oriDark from "./ori-dark.json" with { type: "json" };
import oriLight from "./ori-light.json" with { type: "json" };

export type Theme = {
  primary: string;
  secondary: string;
  accent: string;
  text: string;
  textMuted: string;
  background: string;
  backgroundPanel: string;
  backgroundElement: string;
  border: string;
  borderActive: string;
  warning: string;
  error: string;
  success: string;
  info: string;
  editorBackground: string;
  editorBackgroundFocused: string;
  editorText: string;
};

type HexColor = `#${string}`;
type RefName = string;
type ColorValue = HexColor | RefName;

type ThemeJson = {
  $schema?: string;
  defs?: Record<string, ColorValue>;
  theme: Record<keyof Theme, ColorValue>;
};

type ThemeDefinition = {
  label: string;
  data: ThemeJson;
};

export const THEME_DEFINITIONS = {
  "ori-dark": { label: "Ori Dark", data: oriDark },
  "ori-light": { label: "Ori Light", data: oriLight },
} as const satisfies Record<string, ThemeDefinition>;

export type ThemeName = keyof typeof THEME_DEFINITIONS;
export const DEFAULT_THEME_NAME: ThemeName = "ori-dark";

export const THEME_OPTIONS = Object.entries(THEME_DEFINITIONS).map(([name, entry]) => ({
  name: name as ThemeName,
  label: entry.label,
}));

export function resolveTheme(name: string | undefined): Theme {
  const normalized = normalizeThemeName(name) ?? DEFAULT_THEME_NAME;
  const definition = THEME_DEFINITIONS[normalized];
  return resolveThemeJson(definition.data);
}

export function normalizeThemeName(name?: string | null): ThemeName | undefined {
  if (!name) {
    return undefined;
  }
  const key = name.toLowerCase();
  const match = Object.keys(THEME_DEFINITIONS).find((candidate) => candidate === key);
  return match as ThemeName | undefined;
}

function resolveThemeJson(theme: ThemeJson): Theme {
  const defs = theme.defs ?? {};
  const resolveColor = (value: ColorValue, chain: string[] = []): HexColor => {
    if (typeof value !== "string") {
      throw new Error("Invalid theme color value");
    }
    if (value.startsWith("#")) {
      return value as HexColor;
    }
    if (chain.includes(value)) {
      throw new Error(`Circular theme color reference: ${chain.join(" -> ")} -> ${value}`);
    }
    const ref = defs[value];
    if (!ref) {
      throw new Error(`Unknown theme color reference: ${value}`);
    }
    return resolveColor(ref, [...chain, value]);
  };

  const entries = Object.entries(theme.theme) as Array<[keyof Theme, ColorValue]>;
  const resolved: Partial<Theme> = {};

  for (const [key, value] of entries) {
    resolved[key] = resolveColor(value);
  }

  return resolved as Theme;
}
