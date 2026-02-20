import type { KeyEvent } from "@opentui/core"

export type ParsedKeybind = {
  name?: string
  ctrl: boolean
  meta: boolean
  shift: boolean
  alt: boolean
}

export type KeyboardEventLike = Pick<KeyEvent, "name" | "ctrl" | "meta" | "shift"> & {
  alt?: boolean
  option?: boolean
  raw?: string
  preventDefault?: () => void
}

const normalize = (value?: string) => value?.toLowerCase().trim()

const KEY_ALIASES: Record<string, string> = {
  enter: "return",
}

const parsePattern = (pattern: string) => {
  const tokens = pattern
    .split("+")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)

  const requirements = {
    ctrl: false,
    meta: false,
    shift: false,
    alt: false,
  }

  let keyName: string | undefined

  for (const token of tokens) {
    switch (token) {
      case "ctrl":
      case "control":
        requirements.ctrl = true
        break
      case "meta":
      case "cmd":
      case "command":
        requirements.meta = true
        break
      case "shift":
        requirements.shift = true
        break
      case "alt":
      case "option":
        requirements.alt = true
        break
      default:
        keyName = KEY_ALIASES[token] ?? token
        break
    }
  }

  return { requirements, keyName }
}

const hasUnexpectedModifiers = (requirements: ParsedKeybind, event: ParsedKeybind) => {
  if (!requirements.ctrl && event.ctrl) return true
  if (!requirements.meta && event.meta && !requirements.alt && !event.alt) return true
  if (!requirements.shift && event.shift) return true
  if (!requirements.alt && event.alt) return true
  return false
}

// Some terminals encode Alt as ESC+key and only set `meta`; normalize that shape to Alt.
const isEscMetaAltEncoding = (evt: KeyboardEventLike): boolean => {
  if (!evt.meta || evt.ctrl || evt.shift) {
    return false
  }
  if (!evt.raw?.startsWith("\u001b")) {
    return false
  }
  const name = normalize(evt.name)
  return name === "left" || name === "right"
}

export const Keybind = {
  match(pattern: string, event: ParsedKeybind) {
    if (!pattern) return false
    const { requirements, keyName } = parsePattern(pattern)

    if (requirements.ctrl && !event.ctrl) return false
    if (requirements.meta && !event.meta) return false
    if (requirements.shift && !event.shift) return false
    if (requirements.alt && !event.alt) return false
    if (hasUnexpectedModifiers(requirements, event)) return false

    if (keyName && normalize(event.name) !== keyName) {
      return false
    }

    return true
  },
}

export function useKeybind() {
  const parse = (evt: KeyboardEventLike): ParsedKeybind => ({
    name: normalize(evt.name),
    ctrl: Boolean(evt.ctrl),
    meta: Boolean(evt.meta),
    shift: Boolean(evt.shift),
    alt: Boolean((evt.alt ?? evt.option) || isEscMetaAltEncoding(evt)),
  })

  return { parse }
}
