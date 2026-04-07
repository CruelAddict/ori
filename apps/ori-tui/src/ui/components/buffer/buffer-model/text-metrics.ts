import { resolveRenderLib, type TextareaRenderable, type WidthMethod } from "@opentui/core"
import { type DisplayColumn, displayColumn, type LineCharOffset, lineCharOffset } from "./coords"

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

export function getTabWidth(node: TextareaRenderable): number {
  const renderLib = resolveRenderLib() as unknown as { textBufferGetTabWidth?: (ptr: unknown) => number }
  const textBufferPtr = (node.editBuffer as unknown as { textBufferPtr?: unknown }).textBufferPtr
  if (!textBufferPtr || typeof renderLib.textBufferGetTabWidth !== "function") {
    return 4
  }

  const width = renderLib.textBufferGetTabWidth(textBufferPtr)
  return width > 0 ? width : 4
}

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

export function lineCharOffsetToDisplayColumn(
  text: string,
  offset: LineCharOffset,
  widthMethod: WidthMethod | undefined,
): DisplayColumn {
  if (offset <= 0) {
    return displayColumn(0)
  }

  const end = Math.min(offset, text.length)
  const prefix = text.slice(0, end)
  if (!prefix) {
    return displayColumn(0)
  }

  return displayColumn(unicodeWidth(prefix, widthMethod))
}

export function displayColumnToLineCharOffset(
  text: string,
  targetCol: DisplayColumn,
  tabWidth: number,
  widthMethod: WidthMethod | undefined,
): LineCharOffset {
  if (targetCol <= 0) {
    return lineCharOffset(0)
  }

  let displayCol = 0
  for (const segment of graphemeSegmenter.segment(text)) {
    if (targetCol <= displayCol) {
      return lineCharOffset(segment.index)
    }
    const width = graphemeWidth(segment.segment, displayCol, tabWidth, widthMethod)
    const nextCol = displayCol + width
    if (targetCol <= nextCol) {
      return lineCharOffset(segment.index + segment.segment.length)
    }
    displayCol = nextCol
  }

  return lineCharOffset(text.length)
}
