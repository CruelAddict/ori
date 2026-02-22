const DEFAULT_CURSOR_SCROLLOFF_Y = 2
const CURSOR_SCROLLOFF_ENV = "ORI_CURSOR_SCROLLOFF_Y"

export const cursorScrolloffY = resolveCursorScrolloffY()

function resolveCursorScrolloffY(): number {
  const raw = process.env[CURSOR_SCROLLOFF_ENV]
  if (!raw) {
    return DEFAULT_CURSOR_SCROLLOFF_Y
  }
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value) || value < 0) {
    return DEFAULT_CURSOR_SCROLLOFF_Y
  }
  return value
}
