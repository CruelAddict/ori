import type { WidthMethod } from "@opentui/core"
import { type DisplayColumn, type DocCharOffset, displayColumn, type LineCharOffset, type LineIndex } from "./coords"
import type { Document } from "./document"
import {
  lineCharOffsetDisplayColumns,
  lineCharOffsetToDisplayColumn,
  lineDisplayColumnToCharOffset,
} from "./text-metrics"

export type TextLayout = {
  readonly document: Document
  lineDisplayColumns: (line: LineIndex) => DisplayColumn[]
  docOffsetDisplayColumn: (offset: DocCharOffset) => DisplayColumn
  lineDisplayColumnCharOffset: (line: LineIndex, column: DisplayColumn) => LineCharOffset
  asciiTabDisplayColumns: (text: string) => DisplayColumn[] | undefined
}

export type CreateTextLayoutOptions = {
  tabWidth: number
  getDocument: () => Document
  getWidthMethod: () => WidthMethod | undefined
}

export function createTextLayout(options: CreateTextLayoutOptions): TextLayout {
  const source = {
    get tabWidth() {
      return options.tabWidth
    },
    get widthMethod() {
      return options.getWidthMethod()
    },
  }

  const layout = {
    get document() {
      return options.getDocument()
    },
    lineDisplayColumns: (line) => lineCharOffsetDisplayColumns(source, layout.document.lineText(line)),
    docOffsetDisplayColumn: (offset) => {
      const cursor = layout.document.lineColAt(offset)
      return lineCharOffsetToDisplayColumn(source, layout.document.lineText(cursor.line), cursor.offset)
    },
    lineDisplayColumnCharOffset: (line, column) => {
      return lineDisplayColumnToCharOffset(source, layout.document.lineText(line), column)
    },
    asciiTabDisplayColumns: (text) => buildAsciiTabDisplayColumns(text, options.tabWidth),
  } satisfies TextLayout
  return layout
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
