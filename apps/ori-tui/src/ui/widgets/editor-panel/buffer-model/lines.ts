import { resolveRenderLib, type TextareaRenderable, type WidthMethod } from "@opentui/core"

export type Line = {
  id: string
  text: string
  rendered: boolean
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

let lineIdCounter = 0
let cachedWidthMethod: WidthMethod | undefined

const nextLineId = () => `line-${lineIdCounter++}`

function graphemeWidth(grapheme: string, displayCol: number, tabWidth: number): number {
  if (grapheme === "\t") {
    if (tabWidth <= 0) {
      return 0
    }
    return tabWidth - (displayCol % tabWidth)
  }

  const renderLib = resolveRenderLib()
  const encoded = renderLib.encodeUnicode(grapheme, cachedWidthMethod ?? "unicode")
  if (!encoded) {
    return 0
  }

  let width = 0
  for (const entry of encoded.data) {
    width += entry.width
  }
  renderLib.freeUnicode(encoded)
  return width
}

export function extractWidthMethod(ref: TextareaRenderable | undefined): boolean {
  if (!ref?.ctx?.widthMethod) {
    return false
  }
  if (cachedWidthMethod) {
    return false
  }
  cachedWidthMethod = ref.ctx.widthMethod
  return true
}

export function makeLine(text: string, rendered: boolean): Line {
  return { id: nextLineId(), text, rendered }
}

export function makeLinesFromText(text: string, rendered: boolean): Line[] {
  const parts = text.split("\n")
  const safeParts = parts.length > 0 ? parts : [""]
  return safeParts.map((part) => makeLine(part, rendered))
}

export function toDisplayColumn(text: string, column: number): number {
  if (column <= 0) {
    return 0
  }

  const end = Math.min(column, text.length)
  const prefix = text.slice(0, end)
  if (!prefix) {
    return 0
  }

  const renderLib = resolveRenderLib()
  const encoded = renderLib.encodeUnicode(prefix, cachedWidthMethod ?? "unicode")
  if (!encoded) {
    return 0
  }

  let width = 0
  for (const entry of encoded.data) {
    width += entry.width
  }
  renderLib.freeUnicode(encoded)
  return width
}

export function getTabWidth(node: TextareaRenderable): number {
  const renderLib = resolveRenderLib() as unknown as { textBufferGetTabWidth?: (ptr: unknown) => number }
  const textBufferPtr = (node.editBuffer as unknown as { textBufferPtr?: unknown }).textBufferPtr
  if (!textBufferPtr || typeof renderLib.textBufferGetTabWidth !== "function") {
    return 4
  }

  const width = renderLib.textBufferGetTabWidth(textBufferPtr)
  return width > 0 ? width : 4
}

export function displayColumnToCharIndex(text: string, targetCol: number, tabWidth: number): number {
  if (targetCol <= 0) {
    return 0
  }

  let displayCol = 0
  for (const segment of graphemeSegmenter.segment(text)) {
    if (targetCol <= displayCol) {
      return segment.index
    }
    const width = graphemeWidth(segment.segment, displayCol, tabWidth)
    const nextCol = displayCol + width
    if (targetCol <= nextCol) {
      return segment.index + segment.segment.length
    }
    displayCol = nextCol
  }

  return text.length
}
