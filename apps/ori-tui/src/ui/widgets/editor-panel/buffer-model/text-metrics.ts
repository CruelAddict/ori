import { resolveRenderLib, type WidthMethod } from "@opentui/core"

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

function unicodeWidth(text: string, widthMethod: WidthMethod | undefined): number {
  if (!text) {
    return 0
  }

  const renderLib = resolveRenderLib()
  const encoded = renderLib.encodeUnicode(text, widthMethod ?? "unicode")
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

function graphemeWidth(
  grapheme: string,
  displayCol: number,
  tabWidth: number,
  widthMethod: WidthMethod | undefined,
): number {
  if (grapheme === "\t") {
    if (tabWidth <= 0) {
      return 0
    }
    return tabWidth - (displayCol % tabWidth)
  }

  return unicodeWidth(grapheme, widthMethod)
}

export function toDisplayColumn(text: string, column: number, widthMethod: WidthMethod | undefined): number {
  if (column <= 0) {
    return 0
  }

  const end = Math.min(column, text.length)
  const prefix = text.slice(0, end)
  if (!prefix) {
    return 0
  }

  return unicodeWidth(prefix, widthMethod)
}

export function displayColumnToCharIndex(
  text: string,
  targetCol: number,
  tabWidth: number,
  widthMethod: WidthMethod | undefined,
): number {
  if (targetCol <= 0) {
    return 0
  }

  let displayCol = 0
  for (const segment of graphemeSegmenter.segment(text)) {
    if (targetCol <= displayCol) {
      return segment.index
    }
    const width = graphemeWidth(segment.segment, displayCol, tabWidth, widthMethod)
    const nextCol = displayCol + width
    if (targetCol <= nextCol) {
      return segment.index + segment.segment.length
    }
    displayCol = nextCol
  }

  return text.length
}
