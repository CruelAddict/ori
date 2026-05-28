import type { LineInfo, TextareaRenderable } from "@opentui/core"
import { getViewportBandY } from "@ui/components/ori-scrollbox"
import { buildLineStarts, offsetToLineCol } from "@utils/line-offsets"
import {
  type ContainerX,
  type ContainerY,
  containerX,
  containerY,
  type DisplayColumn,
  type DocCharOffset,
  displayColumn,
  docCharOffset,
  type LineIndex,
  lineIndex,
  type VisualRow,
  visualColumn,
  visualRow,
} from "./coords"
import type { TextLayout } from "./text-layout"

export type BufferCursorState = {
  row: number
  offset: DocCharOffset | undefined
}

export type BufferViewportPoint = {
  x: ContainerX
  y: ContainerY
}

type TextareaBridge = {
  live: () => TextareaRenderable | undefined
  getLineInfo: (ref: TextareaRenderable) => LineInfo
  clearLineInfoCache: (ref?: TextareaRenderable) => void
  setNativeViewport: (
    ref: TextareaRenderable,
    x: number,
    y: number,
    width: number,
    height: number,
    moveCursor?: boolean,
  ) => void
}

type CreateBufferViewportControllerOptions = {
  textarea: TextareaBridge
  layout: TextLayout
  onCursorSync: () => void
}

export function resolveCursorDocOffset(
  text: string,
  row: number,
  col: number,
  starts: readonly number[] = buildLineStarts(text),
): DocCharOffset {
  const line = Math.max(0, Math.min(row, starts.length - 1))
  const start = starts[line] ?? 0
  const next = starts[line + 1] ?? text.length
  const lineLength = Math.max(0, next - start - (next < text.length ? 1 : 0))
  return docCharOffset(start + Math.max(0, Math.min(col, lineLength)))
}

function getVisualLineStartColumn(info: LineInfo, row: VisualRow, sourceLine: LineIndex): DisplayColumn {
  let firstRow = row
  for (let index = row - 1; index >= 0; index -= 1) {
    if (info.lineSources[index] !== sourceLine) {
      break
    }
    firstRow = visualRow(index)
  }

  const firstStart = info.lineStartCols[firstRow] ?? 0
  const currentStart = info.lineStartCols[row] ?? firstStart
  return displayColumn(Math.max(0, currentStart - firstStart))
}

function findVisualLine(info: LineInfo, sourceLine: LineIndex, displayCol: DisplayColumn) {
  for (let index = 0; index < info.lineSources.length; index += 1) {
    if (info.lineSources[index] !== sourceLine) {
      continue
    }

    const row = visualRow(index)
    const startColumn = getVisualLineStartColumn(info, row, sourceLine)
    const nextIndex = index + 1
    const nextStartColumn =
      info.lineSources[nextIndex] === sourceLine
        ? getVisualLineStartColumn(info, visualRow(nextIndex), sourceLine)
        : undefined
    if (nextStartColumn !== undefined && displayCol >= nextStartColumn) {
      continue
    }

    return { row, startColumn }
  }

  return undefined
}

export function resolveViewportOffsetPoint(params: {
  layout: TextLayout
  offset: DocCharOffset
  lineInfo: LineInfo
  scrollY: number
  viewportHeight: number
}): BufferViewportPoint | null {
  const cursor = params.layout.document.lineColAt(params.offset)
  const sourceLine = cursor.line
  const displayCol = params.layout.docOffsetDisplayColumn(params.offset)
  const line = findVisualLine(params.lineInfo, sourceLine, displayCol)
  if (!line) {
    return null
  }

  const viewportRow = line.row - visualRow(params.scrollY)
  if (viewportRow < 0 || viewportRow >= params.viewportHeight) {
    return null
  }

  const visualCol = visualColumn(Math.max(0, displayCol - line.startColumn))
  return {
    x: containerX(visualCol),
    y: containerY(viewportRow),
  }
}

export function resolveVisualCursorDocOffset(params: {
  layout: TextLayout
  visualRow: number
  visualCol: number
  lineInfo: LineInfo
}): DocCharOffset | undefined {
  if (params.lineInfo.lineSources.length === 0) {
    return docCharOffset(0)
  }

  const row = Math.max(0, Math.min(params.visualRow, params.lineInfo.lineSources.length - 1))
  const sourceLine = params.lineInfo.lineSources[row]
  if (sourceLine === undefined) {
    return undefined
  }

  const line = lineIndex(sourceLine)
  const startCol = getVisualLineStartColumn(params.lineInfo, visualRow(row), line)
  const width = params.lineInfo.lineWidthCols[row] ?? 0
  const targetCol = displayColumn(startCol + Math.max(0, Math.min(params.visualCol, width)))
  const lineOffset = params.layout.lineDisplayColumnCharOffset(line, targetCol)

  return docCharOffset(params.layout.document.lineStart(line) + lineOffset)
}

function resolveCursorDocPosition(
  text: string,
  offset: DocCharOffset,
  starts: readonly number[] = buildLineStarts(text),
) {
  const cursor = Math.max(0, Math.min(offset, text.length))
  return offsetToLineCol(cursor, starts)
}

export function createBufferViewportController(options: CreateBufferViewportControllerOptions) {
  let measuredRowVersion = -1
  let measuredRowWidth = 0
  let measuredRowHeight = 0
  let measuredRowCount = 1
  let preservePreferredVisualCol = false
  let preferredVisualCol: number | undefined
  let manualScrollVisualCol: number | undefined
  let manualScrollResetTimer: ReturnType<typeof setTimeout> | undefined

  const preservePreferredVisualColThroughMicrotask = () => {
    preservePreferredVisualCol = true
    queueMicrotask(() => {
      preservePreferredVisualCol = false
    })
  }

  const clearManualScrollVisualCol = () => {
    if (manualScrollResetTimer !== undefined) {
      clearTimeout(manualScrollResetTimer)
      manualScrollResetTimer = undefined
    }
    manualScrollVisualCol = undefined
  }

  const noteManualScroll = () => {
    const ref = options.textarea.live()
    if (!ref) {
      return
    }

    manualScrollVisualCol ??= preferredVisualCol ?? ref.visualCursor.visualCol
    if (manualScrollResetTimer !== undefined) {
      clearTimeout(manualScrollResetTimer)
    }
    manualScrollResetTimer = setTimeout(() => {
      manualScrollResetTimer = undefined
      manualScrollVisualCol = undefined
    }, 120)
  }

  const applyViewportChange = (
    ref: TextareaRenderable,
    x: number,
    y: number,
    width: number,
    height: number,
    moveCursor = false,
  ) => {
    const viewport = ref.editorView.getViewport()
    const cursor = ref.visualCursor
    const currentRow = viewport.offsetY + cursor.visualRow
    const targetVisualCol = manualScrollVisualCol ?? preferredVisualCol ?? cursor.visualCol

    if (!moveCursor) {
      options.textarea.setNativeViewport(ref, x, y, width, height, false)
      return
    }

    options.textarea.setNativeViewport(ref, x, y, width, height, false)

    let nextViewport = ref.editorView.getViewport()
    if (nextViewport.offsetY !== y) {
      const info = options.textarea.getLineInfo(ref)
      const proxyOffset = resolveVisualCursorDocOffset({
        layout: options.layout,
        visualRow: Math.max(0, Math.min(y + cursor.visualRow, info.lineSources.length - 1)),
        visualCol: targetVisualCol,
        lineInfo: info,
      })
      if (proxyOffset !== undefined) {
        const document = options.layout.document
        const proxy = resolveCursorDocPosition(document.text, proxyOffset, document.lineStarts)
        if (ref.logicalCursor.row !== proxy.line || ref.logicalCursor.col !== proxy.col) {
          ref.editBuffer.setCursor(proxy.line, proxy.col)
        }
      }
      options.textarea.setNativeViewport(ref, x, y, width, height, false)
      nextViewport = ref.editorView.getViewport()
    }

    const bandY = getViewportBandY({ height })
    const nextVisualRow = currentRow - nextViewport.offsetY
    const info = options.textarea.getLineInfo(ref)
    const maxRow = Math.max(0, info.lineSources.length - 1)
    const targetRow = Math.max(
      0,
      Math.min(
        nextVisualRow < bandY.start
          ? nextViewport.offsetY + bandY.start
          : nextVisualRow > bandY.end
            ? nextViewport.offsetY + bandY.end
            : currentRow,
        maxRow,
      ),
    )
    const resolvedRow =
      targetRow === currentRow && nextViewport.offsetY !== y
        ? Math.max(0, Math.min(currentRow + (y - nextViewport.offsetY), maxRow))
        : targetRow

    if (resolvedRow === currentRow) {
      return
    }

    const nextOffset = resolveVisualCursorDocOffset({
      layout: options.layout,
      visualRow: resolvedRow,
      visualCol: targetVisualCol,
      lineInfo: info,
    })
    if (nextOffset === undefined) {
      return
    }

    const document = options.layout.document
    const next = resolveCursorDocPosition(document.text, nextOffset, document.lineStarts)
    if (ref.logicalCursor.row !== next.line || ref.logicalCursor.col !== next.col) {
      ref.editBuffer.setCursor(next.line, next.col)
      const cursorViewport = ref.editorView.getViewport()
      if (cursorViewport.offsetY !== nextViewport.offsetY) {
        options.textarea.setNativeViewport(ref, x, nextViewport.offsetY, width, height, false)
      }
    }
  }

  const readCursorState = () => {
    const ref = options.textarea.live()
    if (!ref) {
      return undefined
    }

    const cursor = ref.logicalCursor
    if (!preservePreferredVisualCol && manualScrollVisualCol === undefined) {
      preferredVisualCol = ref.visualCursor.visualCol
    }
    const document = options.layout.document
    return {
      row: cursor.row,
      offset: resolveCursorDocOffset(document.text, cursor.row, cursor.col, document.lineStarts),
    } satisfies BufferCursorState
  }

  const totalVirtualRows = () => {
    const ref = options.textarea.live()
    if (!ref) {
      return 1
    }

    const info = options.textarea.getLineInfo(ref)
    return Math.max(1, ref.editorView.getTotalVirtualLineCount(), info.lineSources.length)
  }

  const measureRows = (viewportRows: number, version: number) => {
    const ref = options.textarea.live()
    if (!ref) {
      return 1
    }

    const width = Math.max(1, ref.width)
    const height = Math.max(1, viewportRows)
    if (measuredRowVersion === version && measuredRowWidth === width && measuredRowHeight === height) {
      return measuredRowCount
    }

    const measured = ref.editorView.measureForDimensions(width, height)?.lineCount
    measuredRowVersion = version
    measuredRowWidth = width
    measuredRowHeight = height
    measuredRowCount = Math.max(1, measured ?? totalVirtualRows())
    return measuredRowCount
  }

  const resetMeasuredRows = () => {
    measuredRowVersion = -1
    measuredRowWidth = 0
    measuredRowHeight = 0
    measuredRowCount = 1
  }

  const setCursorDocOffset = (offset: DocCharOffset) => {
    const ref = options.textarea.live()
    if (!ref) {
      return false
    }

    clearManualScrollVisualCol()
    preferredVisualCol = undefined
    const document = options.layout.document
    const next = resolveCursorDocPosition(document.text, offset, document.lineStarts)
    ref.editBuffer.setCursor(next.line, next.col)
    ref.requestRender()
    return true
  }

  const setViewport = (x: number, y: number, width: number, height: number, moveCursor = false) => {
    const ref = options.textarea.live()
    if (!ref) {
      return false
    }

    if (moveCursor) {
      preservePreferredVisualColThroughMicrotask()
    }
    if (ref.editorView.getViewport().width !== width) {
      options.textarea.clearLineInfoCache(ref)
    }
    applyViewportChange(ref, x, y, width, height, moveCursor)
    if (moveCursor) {
      options.onCursorSync()
    }
    return true
  }

  const resolveViewportPoint = (offset: DocCharOffset) => {
    const ref = options.textarea.live()
    if (!ref) {
      return null
    }

    return resolveViewportOffsetPoint({
      layout: options.layout,
      offset,
      lineInfo: options.textarea.getLineInfo(ref),
      scrollY: ref.scrollY,
      viewportHeight: ref.height,
    })
  }

  const replaceDocRange = (start: DocCharOffset, end: DocCharOffset, insertText: string, nextCursorOffset?: number) => {
    const ref = options.textarea.live()
    if (!ref) {
      return false
    }

    const current = ref.plainText
    const starts = options.layout.document.lineStarts
    const from = resolveCursorDocPosition(current, start, starts)
    const to = resolveCursorDocPosition(current, end, starts)
    clearManualScrollVisualCol()
    preferredVisualCol = undefined
    ref.editBuffer.setCursor(from.line, from.col)
    if (start !== end) {
      ref.editBuffer.deleteRange(from.line, from.col, to.line, to.col)
      ref.editBuffer.setCursor(from.line, from.col)
    }
    if (insertText) {
      ref.insertText(insertText)
    }

    const finalOffset = docCharOffset(start + (nextCursorOffset ?? insertText.length))
    const final = resolveCursorDocPosition(ref.plainText, finalOffset, buildLineStarts(ref.plainText))
    ref.editBuffer.setCursor(final.line, final.col)
    ref.requestRender()
    return true
  }

  return {
    preservePreferredVisualColThroughMicrotask,
    readCursorState,
    noteManualScroll,
    setViewport,
    setCursorDocOffset,
    resolveViewportPoint,
    replaceDocRange,
    totalVirtualRows,
    measureRows,
    resetMeasuredRows,
  }
}
