import type { LineInfo } from "@opentui/core"
import { getViewportBandY } from "@ui/components/ori-scrollbox"
import type {
  BufferTextareaAdapterCursor,
  BufferTextareaAdapterMetrics,
  BufferTextareaAdapterViewport,
} from "./buffer-textarea-adapter"
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
import type { TextGeometry } from "./text-geometry"
import type { Viewport } from "./viewport"

export type BufferCursorState = {
  row: number
  offset: DocCharOffset | undefined
}

export type BufferViewportPoint = {
  x: ContainerX
  y: ContainerY
}

type TextareaBridge = {
  readLineInfo: () => LineInfo | undefined
  clearLineInfo: () => void
  readCursor: () => BufferTextareaAdapterCursor | undefined
  readMetrics: () => BufferTextareaAdapterMetrics | undefined
  readViewport: () => BufferTextareaAdapterViewport | undefined
  getTotalVirtualRows: () => number | undefined
  measureRows: (width: number, height: number) => number | undefined
  setCursor: (row: number, col: number) => void
  setViewport: (
    x: number,
    y: number,
    width: number,
    height: number,
    moveCursor?: boolean,
  ) => TextareaViewportChange | undefined
}

type TextareaViewportChange = {
  cursorChanged: boolean
}

type BufferViewportChange = {
  applied: boolean
  cursorChanged: boolean
}

type CreateBufferViewportControllerOptions = {
  textarea: TextareaBridge
  geometry: TextGeometry
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
  geometry: TextGeometry
  offset: DocCharOffset
  lineInfo: LineInfo
  scrollY: number
  viewportHeight: number
}): BufferViewportPoint | null {
  const point = params.geometry.displayPointAtDocOffset(params.offset)
  const sourceLine = point.line
  const displayCol = point.column
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
  geometry: TextGeometry
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
  return params.geometry.docOffsetAtDisplayColumn(line, targetCol)
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

  const resetCursorTracking = () => {
    clearManualScrollVisualCol()
    preferredVisualCol = undefined
  }

  const noteManualScroll = () => {
    const cursor = options.textarea.readCursor()
    if (!cursor) {
      return
    }

    manualScrollVisualCol ??= preferredVisualCol ?? cursor.visualCol
    if (manualScrollResetTimer !== undefined) {
      clearTimeout(manualScrollResetTimer)
    }
    manualScrollResetTimer = setTimeout(() => {
      manualScrollResetTimer = undefined
      manualScrollVisualCol = undefined
    }, 120)
  }

  const applyViewportChange = (x: number, y: number, width: number, height: number, moveCursor = false) => {
    let cursorChanged = false
    const viewport = options.textarea.readViewport()
    const cursor = options.textarea.readCursor()
    if (!viewport || !cursor) {
      return cursorChanged
    }

    const currentRow = viewport.offsetY + cursor.visualRow
    const targetVisualCol = manualScrollVisualCol ?? preferredVisualCol ?? cursor.visualCol

    if (!moveCursor) {
      return Boolean(options.textarea.setViewport(x, y, width, height, false)?.cursorChanged)
    }

    const firstInfo = options.textarea.readLineInfo()
    if (!firstInfo) {
      return cursorChanged
    }
    if (firstInfo.lineSources.length === options.geometry.document.lineStarts.length) {
      return Boolean(options.textarea.setViewport(x, y, width, height, true)?.cursorChanged)
    }

    cursorChanged = cursorChanged || Boolean(options.textarea.setViewport(x, y, width, height, false)?.cursorChanged)

    let nextViewport = options.textarea.readViewport()
    if (!nextViewport) {
      return cursorChanged
    }
    if (nextViewport.offsetY !== y) {
      const info = firstInfo
      const proxyOffset = resolveVisualCursorDocOffset({
        geometry: options.geometry,
        visualRow: Math.max(0, Math.min(y + cursor.visualRow, info.lineSources.length - 1)),
        visualCol: targetVisualCol,
        lineInfo: info,
      })
      if (proxyOffset !== undefined) {
        const document = options.geometry.document
        const proxy = document.positionAtOffset(proxyOffset)
        const nextCursor = options.textarea.readCursor()
        if (!nextCursor || nextCursor.logicalRow !== proxy.line || nextCursor.logicalCol !== proxy.offset) {
          options.textarea.setCursor(proxy.line, proxy.offset)
          cursorChanged = true
        }
      }
      const viewportChange = options.textarea.setViewport(x, y, width, height, false)
      cursorChanged = cursorChanged || Boolean(viewportChange?.cursorChanged)
      nextViewport = options.textarea.readViewport()
      if (!nextViewport) {
        return cursorChanged
      }
    }

    const bandY = getViewportBandY({ height })
    const nextVisualRow = currentRow - nextViewport.offsetY
    const info = options.textarea.readLineInfo()
    if (!info) {
      return cursorChanged
    }
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
      return cursorChanged
    }

    const nextOffset = resolveVisualCursorDocOffset({
      geometry: options.geometry,
      visualRow: resolvedRow,
      visualCol: targetVisualCol,
      lineInfo: info,
    })
    if (nextOffset === undefined) {
      return cursorChanged
    }

    const document = options.geometry.document
    const next = document.positionAtOffset(nextOffset)
    const nextCursor = options.textarea.readCursor()
    if (!nextCursor || nextCursor.logicalRow !== next.line || nextCursor.logicalCol !== next.offset) {
      options.textarea.setCursor(next.line, next.offset)
      cursorChanged = true
      const cursorViewport = options.textarea.readViewport()
      if (cursorViewport && cursorViewport.offsetY !== nextViewport.offsetY) {
        const viewportChange = options.textarea.setViewport(x, nextViewport.offsetY, width, height, false)
        cursorChanged = cursorChanged || Boolean(viewportChange?.cursorChanged)
      }
    }
    return cursorChanged
  }

  const captureCursorState = () => {
    const cursor = options.textarea.readCursor()
    if (!cursor) {
      return undefined
    }

    if (!preservePreferredVisualCol && manualScrollVisualCol === undefined) {
      preferredVisualCol = cursor.visualCol
    }
    const document = options.geometry.document
    return {
      row: cursor.logicalRow,
      offset: document.offsetAtLineChar(cursor.logicalRow, cursor.logicalCol),
    } satisfies BufferCursorState
  }

  const readViewport = () => {
    const metrics = options.textarea.readMetrics()
    const cursor = options.textarea.readCursor()
    const info = options.textarea.readLineInfo()
    if (!metrics || !cursor || !info) {
      return undefined
    }

    return {
      geometry: options.geometry,
      lineInfo: info,
      scrollY: metrics.scrollY,
      height: metrics.height,
      focusedLine: lineIndex(cursor.logicalRow),
    } satisfies Viewport
  }

  const totalVirtualRows = () => {
    const info = options.textarea.readLineInfo()
    if (!info) {
      return 1
    }

    return Math.max(1, options.textarea.getTotalVirtualRows() ?? 0, info.lineSources.length)
  }

  const measureRows = (viewportRows: number, version: number) => {
    const metrics = options.textarea.readMetrics()
    if (!metrics) {
      return 1
    }

    const width = Math.max(1, metrics.width)
    const height = Math.max(1, viewportRows)
    if (measuredRowVersion === version && measuredRowWidth === width && measuredRowHeight === height) {
      return measuredRowCount
    }

    const measured = options.textarea.measureRows(width, height)
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

  const setViewport = (
    x: number,
    y: number,
    width: number,
    height: number,
    moveCursor = false,
  ): BufferViewportChange => {
    const viewport = options.textarea.readViewport()
    if (!viewport) {
      return { applied: false, cursorChanged: false }
    }

    if (moveCursor) {
      preservePreferredVisualColThroughMicrotask()
    }
    if (viewport.width !== width) {
      options.textarea.clearLineInfo()
    }
    return {
      applied: true,
      cursorChanged: applyViewportChange(x, y, width, height, moveCursor),
    }
  }

  const resolveViewportPoint = (offset: DocCharOffset) => {
    const metrics = options.textarea.readMetrics()
    const info = options.textarea.readLineInfo()
    if (!metrics || !info) {
      return null
    }

    return resolveViewportOffsetPoint({
      geometry: options.geometry,
      offset,
      lineInfo: info,
      scrollY: metrics.scrollY,
      viewportHeight: metrics.height,
    })
  }

  return {
    preservePreferredVisualColThroughMicrotask,
    captureCursorState,
    readViewport,
    noteManualScroll,
    resetCursorTracking,
    setViewport,
    resolveViewportPoint,
    totalVirtualRows,
    measureRows,
    resetMeasuredRows,
  }
}
