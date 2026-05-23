import { resolveRenderLib, type TextareaRenderable, type WidthMethod } from "@opentui/core"
import {
  type DisplayColumn,
  displayColumn,
  type LineCharOffset,
  type LineCharRange,
  type LineDisplayRange,
  lineCharOffset,
  lineDisplayRange,
} from "./coords"

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

type MetricsSource = {
  tabWidth: number
  widthMethod: WidthMethod | undefined
}

function isSingleWidthAsciiPrefix(text: string, end: number): boolean {
  for (let i = 0; i < end; i += 1) {
    const code = text.charCodeAt(i)
    if (code < 32 || code > 126) {
      return false
    }
  }
  return true
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
  source: MetricsSource,
  text: string,
  offset: LineCharOffset,
): DisplayColumn {
  if (offset <= 0) {
    return displayColumn(0)
  }

  const end = Math.min(offset, text.length)
  if (isSingleWidthAsciiPrefix(text, end)) {
    return displayColumn(end)
  }

  let displayCol = 0
  for (const segment of graphemeSegmenter.segment(text)) {
    if (segment.index >= end) {
      return displayColumn(displayCol)
    }
    if (segment.index + segment.segment.length > end) {
      return displayColumn(displayCol)
    }

    displayCol += graphemeWidth(segment.segment, displayCol, source.tabWidth, source.widthMethod)
  }

  return displayColumn(displayCol)
}

export function lineCharRangeToDisplayRange(
  source: MetricsSource,
  text: string,
  range: LineCharRange,
): LineDisplayRange {
  return lineDisplayRange(
    lineCharOffsetToDisplayColumn(source, text, range.start),
    lineCharOffsetToDisplayColumn(source, text, range.end),
  )
}

export function lineCharOffsetDisplayColumns(source: MetricsSource, text: string): DisplayColumn[] {
  const columns = new Array<DisplayColumn>(text.length + 1)
  let displayCol = 0
  let offset = 0
  columns[0] = displayColumn(0)

  for (const segment of graphemeSegmenter.segment(text)) {
    while (offset < segment.index) {
      columns[offset] = displayColumn(displayCol)
      offset += 1
    }

    const end = segment.index + segment.segment.length
    for (let i = segment.index; i < end; i += 1) {
      columns[i] = displayColumn(displayCol)
    }

    displayCol += graphemeWidth(segment.segment, displayCol, source.tabWidth, source.widthMethod)
    columns[end] = displayColumn(displayCol)
    offset = end
  }

  while (offset <= text.length) {
    columns[offset] = displayColumn(displayCol)
    offset += 1
  }

  return columns
}

export function lineDisplayWidth(source: MetricsSource, text: string): DisplayColumn {
  return lineCharOffsetToDisplayColumn(source, text, lineCharOffset(text.length))
}

export function lineDisplayColumnToCharOffset(
  source: MetricsSource,
  text: string,
  targetCol: DisplayColumn,
): LineCharOffset {
  if (targetCol <= 0) {
    return lineCharOffset(0)
  }

  if (isSingleWidthAsciiPrefix(text, text.length)) {
    return lineCharOffset(Math.min(targetCol, text.length))
  }

  let displayCol = 0
  for (const segment of graphemeSegmenter.segment(text)) {
    if (targetCol <= displayCol) {
      return lineCharOffset(segment.index)
    }
    const width = graphemeWidth(segment.segment, displayCol, source.tabWidth, source.widthMethod)
    const nextCol = displayCol + width
    if (targetCol <= nextCol) {
      return lineCharOffset(segment.index + segment.segment.length)
    }
    displayCol = nextCol
  }

  return lineCharOffset(text.length)
}

export function applyRefTabWidth(node: TextareaRenderable, tabWidth: number) {
  const renderLib = resolveRenderLib() as unknown as { textBufferSetTabWidth?: (ptr: unknown, width: number) => void }
  const textBufferPtr = (node.editBuffer as unknown as { textBufferPtr?: unknown }).textBufferPtr
  if (!textBufferPtr || typeof renderLib.textBufferSetTabWidth !== "function") {
    return
  }

  renderLib.textBufferSetTabWidth(textBufferPtr, tabWidth)
}
