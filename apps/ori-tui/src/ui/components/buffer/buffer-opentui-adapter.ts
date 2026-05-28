import type { LineInfo, MouseEvent, TextareaRenderable } from "@opentui/core"
import { applyRefTabWidth } from "./text-metrics"

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
  onLineInfoChange: () => void
  onCursorSync: () => void
  onPreservePreferredVisualCol: () => void
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
          options.onPreservePreferredVisualCol()
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
        options.onPreservePreferredVisualCol()
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

  const setNativeViewport = (
    ref: TextareaRenderable,
    x: number,
    y: number,
    width: number,
    height: number,
    moveCursor = false,
  ) => {
    const patch = ref as TextareaRuntimePatch
    const originalSetViewport = patch.__oriOriginalSetViewport ?? ref.editorView.setViewport.bind(ref.editorView)
    originalSetViewport(x, y, width, height, moveCursor)
  }

  return {
    attach,
    detach,
    live,
    getLineInfo,
    clearLineInfoCache,
    setNativeViewport,
  }
}
