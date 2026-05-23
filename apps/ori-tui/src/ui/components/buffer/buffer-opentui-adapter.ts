import type { LineInfo, MouseEvent, TextareaRenderable, WidthMethod } from "@opentui/core"
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
  lineCharOffset,
  lineIndex,
  type VisualRow,
  visualColumn,
  visualRow,
} from "./coords"
import { applyRefTabWidth, lineCharOffsetToDisplayColumn, lineDisplayColumnToCharOffset } from "./text-metrics"

export type BufferCursorState = {
  row: number
  offset: DocCharOffset | undefined
}

export type BufferViewportPoint = {
  x: ContainerX
  y: ContainerY
}

type TextareaRuntimePatch = TextareaRenderable & {
  __oriRuntimeSyncPatch?: boolean
  __oriScrollPassthroughPatch?: boolean
  __oriOriginalSetViewport?: (x: number, y: number, width: number, height: number, moveCursor?: boolean) => void
  editorView: {
    moveUpVisual: () => void
    moveDownVisual: () => void
    setViewport: (x: number, y: number, width: number, height: number, moveCursor?: boolean) => void
    setViewportSize: (width: number, height: number) => void
    getLogicalLineInfo: () => LineInfo
  }
  onSelectionChanged: (selection: unknown) => boolean
  handleKeyPress: (key: { ctrl: boolean; meta: boolean; super: boolean; hyper: boolean; sequence?: string }) => boolean
  insertText: (text: string) => void
}

type TextareaVirtualLinePatch = TextareaRenderable & {
  __oriVirtualLineCountPatch?: boolean
}

type EditBufferLargeTextPatch = TextareaRenderable["editBuffer"] & {
  __oriLargeTextReadPatch?: boolean
  lib?: {
    editBufferGetText: (buffer: unknown, maxLength: number) => Uint8Array | null
    decoder: TextDecoder
  }
  bufferPtr?: unknown
}

const EDIT_BUFFER_GET_TEXT_MAX_SIZE = 1024 * 1024
const EDIT_BUFFER_GET_TEXT_MAX_SIZE_CAP = 64 * 1024 * 1024

type CreateBufferOpentuiAdapterOptions = {
  tabWidth: number
  getText: () => string
  getLineStarts: () => readonly number[]
  onLineInfoChange: () => void
  onCursorSync: () => void
}

export function resolveCursorDocOffset(
  text: string,
  row: number,
  col: number,
  starts = buildLineStarts(text),
): DocCharOffset {
  const line = Math.max(0, Math.min(row, starts.length - 1))
  const start = starts[line] ?? 0
  const next = starts[line + 1] ?? text.length
  const lineLength = Math.max(0, next - start - (next < text.length ? 1 : 0))
  return docCharOffset(start + Math.max(0, Math.min(col, lineLength)))
}

function getLineText(text: string, starts: readonly number[], line: LineIndex) {
  const start = starts[line] ?? 0
  const next = line + 1 < starts.length ? (starts[line + 1] ?? text.length) : text.length
  const end = next > start && text[next - 1] === "\n" ? next - 1 : next
  return text.slice(start, end)
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
  text: string
  offset: DocCharOffset
  lineStarts?: readonly number[]
  lineInfo: LineInfo
  widthMethod: WidthMethod | undefined
  tabWidth: number
  scrollY: number
  viewportHeight: number
}): BufferViewportPoint | null {
  const starts = params.lineStarts ?? buildLineStarts(params.text)
  const cursor = offsetToLineCol(params.offset, starts)
  const sourceLine = lineIndex(cursor.line)
  const lineText = getLineText(params.text, starts, sourceLine)
  const displayCol = lineCharOffsetToDisplayColumn(
    { tabWidth: params.tabWidth, widthMethod: params.widthMethod },
    lineText,
    lineCharOffset(cursor.col),
  )
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
  text: string
  visualRow: number
  visualCol: number
  lineStarts?: readonly number[]
  lineInfo: LineInfo
  widthMethod: WidthMethod | undefined
  tabWidth: number
}): DocCharOffset | undefined {
  if (params.lineInfo.lineSources.length === 0) {
    return docCharOffset(0)
  }

  const row = Math.max(0, Math.min(params.visualRow, params.lineInfo.lineSources.length - 1))
  const sourceLine = params.lineInfo.lineSources[row]
  if (sourceLine === undefined) {
    return undefined
  }

  const starts = params.lineStarts ?? buildLineStarts(params.text)
  const line = lineIndex(sourceLine)
  const lineText = getLineText(params.text, starts, line)
  const startCol = getVisualLineStartColumn(params.lineInfo, visualRow(row), line)
  const width = params.lineInfo.lineWidthCols[row] ?? 0
  const targetCol = displayColumn(startCol + Math.max(0, Math.min(params.visualCol, width)))
  const lineOffset = lineDisplayColumnToCharOffset(
    { tabWidth: params.tabWidth, widthMethod: params.widthMethod },
    lineText,
    targetCol,
  )

  return docCharOffset((starts[line] ?? 0) + lineOffset)
}

function resolveCursorDocPosition(text: string, offset: DocCharOffset, starts = buildLineStarts(text)) {
  const cursor = Math.max(0, Math.min(offset, text.length))
  return offsetToLineCol(cursor, starts)
}

function readFullEditBufferText(editBuffer: EditBufferLargeTextPatch, fallback: () => string) {
  if (!editBuffer.lib || editBuffer.bufferPtr === undefined) {
    return fallback()
  }

  let maxLength = EDIT_BUFFER_GET_TEXT_MAX_SIZE
  let textBytes = editBuffer.lib.editBufferGetText(editBuffer.bufferPtr, maxLength)
  if (!textBytes) {
    return ""
  }

  while (textBytes.length === maxLength && maxLength < EDIT_BUFFER_GET_TEXT_MAX_SIZE_CAP) {
    maxLength *= 2
    const next = editBuffer.lib.editBufferGetText(editBuffer.bufferPtr, maxLength)
    if (!next) {
      break
    }
    textBytes = next
  }

  return editBuffer.lib.decoder.decode(textBytes)
}

export function createBufferOpentuiAdapter(options: CreateBufferOpentuiAdapterOptions) {
  let editorRef: TextareaRenderable | undefined
  let measuredRowVersion = -1
  let measuredRowWidth = 0
  let measuredRowHeight = 0
  let measuredRowCount = 1
  let preservePreferredVisualCol = false
  let preferredVisualCol: number | undefined
  let manualScrollVisualCol: number | undefined
  let manualScrollResetTimer: ReturnType<typeof setTimeout> | undefined
  let cachedLineInfoRef: TextareaRenderable | undefined
  let cachedLineInfo: LineInfo | undefined

  const clearLineInfoCache = (node = editorRef) => {
    if (!node) {
      cachedLineInfoRef = undefined
      cachedLineInfo = undefined
      return
    }

    if (cachedLineInfoRef === node) {
      cachedLineInfoRef = undefined
      cachedLineInfo = undefined
    }
  }

  const getLineInfo = (ref: TextareaRenderable) => {
    if (cachedLineInfoRef === ref && cachedLineInfo) {
      return cachedLineInfo
    }

    const info = ref.lineInfo
    cachedLineInfoRef = ref
    cachedLineInfo = info
    return info
  }

  const handleLineInfoChange = () => {
    clearLineInfoCache()
    options.onLineInfoChange()
  }

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
    const ref = live()
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
    originalSetViewport: (x: number, y: number, width: number, height: number, moveCursor?: boolean) => void,
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
      originalSetViewport(x, y, width, height, false)
      return
    }

    originalSetViewport(x, y, width, height, false)

    let nextViewport = ref.editorView.getViewport()
    if (nextViewport.offsetY !== y) {
      const info = getLineInfo(ref)
      const proxyOffset = resolveVisualCursorDocOffset({
        text: options.getText(),
        visualRow: Math.max(0, Math.min(y + cursor.visualRow, info.lineSources.length - 1)),
        visualCol: targetVisualCol,
        lineStarts: options.getLineStarts(),
        lineInfo: info,
        widthMethod: ref.ctx?.widthMethod,
        tabWidth: options.tabWidth,
      })
      if (proxyOffset !== undefined) {
        const proxy = resolveCursorDocPosition(options.getText(), proxyOffset, options.getLineStarts())
        if (ref.logicalCursor.row !== proxy.line || ref.logicalCursor.col !== proxy.col) {
          ref.editBuffer.setCursor(proxy.line, proxy.col)
        }
      }
      originalSetViewport(x, y, width, height, false)
      nextViewport = ref.editorView.getViewport()
    }

    const bandY = getViewportBandY({ height })
    const nextVisualRow = currentRow - nextViewport.offsetY
    const info = getLineInfo(ref)
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
      text: options.getText(),
      visualRow: resolvedRow,
      visualCol: targetVisualCol,
      lineStarts: options.getLineStarts(),
      lineInfo: info,
      widthMethod: ref.ctx?.widthMethod,
      tabWidth: options.tabWidth,
    })
    if (nextOffset === undefined) {
      return
    }

    const next = resolveCursorDocPosition(options.getText(), nextOffset, options.getLineStarts())
    if (ref.logicalCursor.row !== next.line || ref.logicalCursor.col !== next.col) {
      ref.editBuffer.setCursor(next.line, next.col)
      const cursorViewport = ref.editorView.getViewport()
      if (cursorViewport.offsetY !== nextViewport.offsetY) {
        originalSetViewport(x, nextViewport.offsetY, width, height, false)
      }
    }
  }

  const live = () => {
    if (!editorRef || editorRef.isDestroyed) {
      return undefined
    }

    return editorRef
  }

  const patchVirtualLineCount = (node: TextareaRenderable) => {
    const patch = node as TextareaVirtualLinePatch
    if (patch.__oriVirtualLineCountPatch) {
      return
    }

    Object.defineProperty(node, "virtualLineCount", {
      configurable: true,
      get() {
        return this.editorView.getTotalVirtualLineCount()
      },
    })

    patch.__oriVirtualLineCountPatch = true
  }

  const patchRuntimeSync = (node: TextareaRenderable) => {
    const patch = node as TextareaRuntimePatch
    if (patch.__oriRuntimeSyncPatch) {
      return
    }

    const originalGetLogicalLineInfo = patch.editorView.getLogicalLineInfo.bind(patch.editorView)
    patch.editorView.getLogicalLineInfo = (() => {
      if (cachedLineInfoRef === patch && cachedLineInfo) {
        return cachedLineInfo
      }

      const info = originalGetLogicalLineInfo()
      cachedLineInfoRef = patch
      cachedLineInfo = info
      return info
    }) as TextareaRuntimePatch["editorView"]["getLogicalLineInfo"]

    const wrap = <T extends Exclude<keyof TextareaRuntimePatch["editorView"], "setViewport">>(key: T) => {
      const original = patch.editorView[key].bind(patch.editorView)
      patch.editorView[key] = ((...args: Parameters<TextareaRuntimePatch["editorView"][T]>) => {
        if (key === "moveUpVisual" || key === "moveDownVisual") {
          preservePreferredVisualColThroughMicrotask()
        }
        if (key === "setViewportSize") {
          const previousViewport = patch.editorView.getViewport()
          if (previousViewport.width !== args[0]) {
            clearLineInfoCache(patch)
          }
        }
        const result = original(...args)
        options.onCursorSync()
        return result
      }) as TextareaRuntimePatch["editorView"][T]
    }

    wrap("moveUpVisual")
    wrap("moveDownVisual")
    wrap("setViewportSize")

    const originalSetViewport = patch.editorView.setViewport.bind(patch.editorView)
    patch.__oriOriginalSetViewport = originalSetViewport
    patch.editorView.setViewport = ((x, y, width, height, moveCursor = false) => {
      const previousViewport = patch.editorView.getViewport()
      const previousLogicalRow = patch.logicalCursor.row
      const previousLogicalCol = patch.logicalCursor.col
      const previousVisualRow = patch.visualCursor.visualRow
      const previousVisualCol = patch.visualCursor.visualCol
      if (previousViewport.width !== width) {
        clearLineInfoCache(patch)
      }
      if (moveCursor) {
        preservePreferredVisualColThroughMicrotask()
      }
      originalSetViewport(x, y, width, height, moveCursor)
      if (
        moveCursor ||
        patch.logicalCursor.row !== previousLogicalRow ||
        patch.logicalCursor.col !== previousLogicalCol ||
        patch.visualCursor.visualRow !== previousVisualRow ||
        patch.visualCursor.visualCol !== previousVisualCol
      ) {
        options.onCursorSync()
      }
    }) as TextareaRuntimePatch["editorView"]["setViewport"]

    const originalOnSelectionChanged = patch.onSelectionChanged.bind(patch)
    patch.onSelectionChanged = ((selection: unknown) => {
      const result = originalOnSelectionChanged(selection)
      options.onCursorSync()
      return result
    }) as TextareaRuntimePatch["onSelectionChanged"]

    patch.__oriRuntimeSyncPatch = true
  }

  const patchScrollPassthrough = (node: TextareaRenderable) => {
    const patch = node as TextareaRuntimePatch
    if (patch.__oriScrollPassthroughPatch) {
      return
    }

    const originalOnMouseEvent = node.onMouseEvent.bind(node)
    node.onMouseEvent = ((event: MouseEvent) => {
      if (event.type === "scroll") {
        return
      }

      originalOnMouseEvent(event)
    }) as typeof node.onMouseEvent

    patch.__oriScrollPassthroughPatch = true
  }

  const patchLargeTextRead = (node: TextareaRenderable) => {
    const editBuffer = node.editBuffer as EditBufferLargeTextPatch
    if (editBuffer.__oriLargeTextReadPatch) {
      return
    }

    const originalGetText = editBuffer.getText.bind(editBuffer)
    editBuffer.getText = (() => readFullEditBufferText(editBuffer, originalGetText)) as typeof editBuffer.getText
    editBuffer.__oriLargeTextReadPatch = true
  }

  const attach = (node: TextareaRenderable | undefined) => {
    if (editorRef === node) {
      return
    }

    if (editorRef && editorRef !== node && !editorRef.isDestroyed) {
      editorRef.off("line-info-change", handleLineInfoChange)
      clearLineInfoCache(editorRef)
    }

    editorRef = node
    if (!node) {
      return
    }

    patchVirtualLineCount(node)
    patchRuntimeSync(node)
    patchScrollPassthrough(node)
    patchLargeTextRead(node)
    applyRefTabWidth(node, options.tabWidth)
    node.on("line-info-change", handleLineInfoChange)
  }

  const detach = () => {
    if (!editorRef || editorRef.isDestroyed) {
      editorRef = undefined
      return
    }

    editorRef.off("line-info-change", handleLineInfoChange)
    clearLineInfoCache(editorRef)
    editorRef = undefined
  }

  const readCursorState = () => {
    const ref = live()
    if (!ref) {
      return undefined
    }

    const cursor = ref.logicalCursor
    if (!preservePreferredVisualCol && manualScrollVisualCol === undefined) {
      preferredVisualCol = ref.visualCursor.visualCol
    }
    return {
      row: cursor.row,
      offset: resolveCursorDocOffset(options.getText(), cursor.row, cursor.col, options.getLineStarts()),
    } satisfies BufferCursorState
  }

  const totalVirtualRows = () => {
    const ref = live()
    if (!ref) {
      return 1
    }

    const info = getLineInfo(ref)
    return Math.max(1, ref.editorView.getTotalVirtualLineCount(), info.lineSources.length)
  }

  const measureRows = (viewportRows: number, version: number) => {
    const ref = live()
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
    const ref = live()
    if (!ref) {
      return false
    }

    clearManualScrollVisualCol()
    preferredVisualCol = undefined
    const next = resolveCursorDocPosition(options.getText(), offset, options.getLineStarts())
    ref.editBuffer.setCursor(next.line, next.col)
    ref.requestRender()
    return true
  }

  const setViewport = (x: number, y: number, width: number, height: number, moveCursor = false) => {
    const ref = live()
    if (!ref) {
      return false
    }

    if (moveCursor) {
      preservePreferredVisualColThroughMicrotask()
    }
    const patch = ref as TextareaRuntimePatch
    const originalSetViewport = patch.__oriOriginalSetViewport ?? ref.editorView.setViewport.bind(ref.editorView)
    if (ref.editorView.getViewport().width !== width) {
      clearLineInfoCache(ref)
    }
    applyViewportChange(ref, originalSetViewport, x, y, width, height, moveCursor)
    if (moveCursor) {
      options.onCursorSync()
    }
    return true
  }

  const resolveViewportPoint = (offset: DocCharOffset) => {
    const ref = live()
    if (!ref) {
      return null
    }

    return resolveViewportOffsetPoint({
      text: options.getText(),
      offset,
      lineStarts: options.getLineStarts(),
      lineInfo: getLineInfo(ref),
      widthMethod: ref.ctx?.widthMethod,
      tabWidth: options.tabWidth,
      scrollY: ref.scrollY,
      viewportHeight: ref.height,
    })
  }

  const replaceDocRange = (start: DocCharOffset, end: DocCharOffset, insertText: string, nextCursorOffset?: number) => {
    const ref = live()
    if (!ref) {
      return false
    }

    const current = ref.plainText
    const starts = options.getLineStarts()
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
    attach,
    detach,
    live,
    readCursorState,
    noteManualScroll,
    setViewport,
    getLineInfo,
    setCursorDocOffset,
    resolveViewportPoint,
    replaceDocRange,
    totalVirtualRows,
    measureRows,
    resetMeasuredRows,
  }
}
