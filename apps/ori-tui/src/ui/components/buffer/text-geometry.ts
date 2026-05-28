import type { WidthMethod } from "@opentui/core"
import {
  type DisplayColumn,
  type DocCharOffset,
  displayColumn,
  docCharOffset,
  type LineCharOffset,
  type LineDisplayRange,
  type LineIndex,
  lineCharOffset,
  lineDisplayRange,
} from "./coords"
import type { Document } from "./document"
import {
  lineCharOffsetDisplayColumns,
  lineCharOffsetToDisplayColumn,
  lineDisplayColumnToCharOffset,
} from "./text-metrics"

export type TextLineGeometry = {
  readonly index: LineIndex
  readonly start: DocCharOffset
  readonly end: DocCharOffset
  readonly text: string
  displayColumnAt: (offset: LineCharOffset) => DisplayColumn
  displayRange: (start: LineCharOffset, end: LineCharOffset) => LineDisplayRange
  docRangeDisplayRange: (start: DocCharOffset, end: DocCharOffset) => LineDisplayRange
  charOffsetAtDisplayColumn: (column: DisplayColumn) => LineCharOffset
  docOffsetAt: (offset: LineCharOffset) => DocCharOffset
  docOffsetAtDisplayColumn: (column: DisplayColumn) => DocCharOffset
}

export type TextLinePosition = {
  line: TextLineGeometry
  offset: LineCharOffset
}

export type TextDisplayPoint = {
  line: LineIndex
  column: DisplayColumn
}

export type TextGeometry = {
  readonly document: Document
  line: (line: LineIndex) => TextLineGeometry
  lineAtDocOffset: (offset: DocCharOffset) => TextLinePosition
  displayPointAtDocOffset: (offset: DocCharOffset) => TextDisplayPoint
  docOffsetDisplayColumn: (offset: DocCharOffset) => DisplayColumn
  lineDisplayColumnCharOffset: (line: LineIndex, column: DisplayColumn) => LineCharOffset
  docOffsetAtDisplayColumn: (line: LineIndex, column: DisplayColumn) => DocCharOffset
}

export type CreateTextGeometryOptions = {
  tabWidth: number
  getDocument: () => Document
  getWidthMethod: () => WidthMethod | undefined
}

export function createTextGeometry(options: CreateTextGeometryOptions): TextGeometry {
  const source = {
    get tabWidth() {
      return options.tabWidth
    },
    get widthMethod() {
      return options.getWidthMethod()
    },
  }

  const geometry = {
    get document() {
      return options.getDocument()
    },
    line: (line) => createTextLineGeometry(source, geometry.document, line),
    lineAtDocOffset: (offset) => {
      const cursor = geometry.document.positionAtOffset(offset)
      return {
        line: geometry.line(cursor.line),
        offset: cursor.offset,
      }
    },
    displayPointAtDocOffset: (offset) => {
      const position = geometry.lineAtDocOffset(offset)
      return {
        line: position.line.index,
        column: position.line.displayColumnAt(position.offset),
      }
    },
    docOffsetDisplayColumn: (offset) => {
      return geometry.displayPointAtDocOffset(offset).column
    },
    lineDisplayColumnCharOffset: (line, column) => {
      return geometry.line(line).charOffsetAtDisplayColumn(column)
    },
    docOffsetAtDisplayColumn: (line, column) => {
      return geometry.line(line).docOffsetAtDisplayColumn(column)
    },
  } satisfies TextGeometry
  return geometry
}

function createTextLineGeometry(
  source: { tabWidth: number; widthMethod: WidthMethod | undefined },
  document: Document,
  line: LineIndex,
): TextLineGeometry {
  const start = document.lineStart(line)
  const end = document.lineEnd(line)
  const text = document.text.slice(start, end)
  const simple = isSingleWidthAsciiLine(text)
  let columns: DisplayColumn[] | undefined

  const displayColumns = () => {
    if (columns !== undefined) {
      return columns
    }

    columns = buildAsciiTabDisplayColumns(text, source.tabWidth) ?? lineCharOffsetDisplayColumns(source, text)
    return columns
  }
  const displayRange = (rangeStart: LineCharOffset, rangeEnd: LineCharOffset) => {
    if (simple) {
      return lineDisplayRange(rangeStart, rangeEnd)
    }

    const lineColumns = displayColumns()
    return {
      start: lineColumns[rangeStart] ?? displayColumn(0),
      end: lineColumns[rangeEnd] ?? lineColumns[lineColumns.length - 1] ?? displayColumn(0),
    }
  }

  return {
    index: line,
    start,
    end,
    text,
    displayColumnAt: (offset) => {
      if (simple) {
        return displayColumn(Math.max(0, Math.min(offset, text.length)))
      }

      return lineCharOffsetToDisplayColumn(source, text, offset)
    },
    displayRange,
    docRangeDisplayRange: (rangeStart, rangeEnd) => {
      return displayRange(docOffsetToLineOffset(rangeStart), docOffsetToLineOffset(rangeEnd))
    },
    charOffsetAtDisplayColumn: (column) => lineDisplayColumnToCharOffset(source, text, column),
    docOffsetAt: (offset) => docCharOffset(start + Math.max(0, Math.min(offset, end - start))),
    docOffsetAtDisplayColumn: (column) => {
      return docCharOffset(start + lineDisplayColumnToCharOffset(source, text, column))
    },
  }

  function docOffsetToLineOffset(offset: DocCharOffset) {
    return lineCharOffset(Math.max(0, Math.min(offset, end) - start))
  }
}

function isSingleWidthAsciiLine(text: string) {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if (code < 32 || code > 126) {
      return false
    }
  }
  return true
}

function buildAsciiTabDisplayColumns(text: string, tabWidth: number): DisplayColumn[] | undefined {
  const columns = new Array<DisplayColumn>(text.length + 1)
  let column = 0
  columns[0] = displayColumn(0)
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if (code === 9) {
      column += tabWidth - (column % tabWidth)
      columns[i + 1] = displayColumn(column)
      continue
    }
    if (code < 32 || code > 126) {
      return undefined
    }
    column += 1
    columns[i + 1] = displayColumn(column)
  }
  return columns
}
