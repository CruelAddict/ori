import type { TextareaRenderable } from "@opentui/core"
import { type DocCharOffset, docCharOffset } from "./buffer-model/coords"
import { applyRefTabWidth } from "./buffer-model/text-metrics"

export type BufferCursorState = {
  row: number
  offset: DocCharOffset | undefined
}

type TextareaRuntimePatch = TextareaRenderable & {
  __oriRuntimeSyncPatch?: boolean
  editorView: {
    moveUpVisual: () => void
    moveDownVisual: () => void
    setViewport: (x: number, y: number, width: number, height: number, moveCursor?: boolean) => void
    setViewportSize: (width: number, height: number) => void
  }
  onSelectionChanged: (selection: unknown) => boolean
}

type TextareaVirtualLinePatch = TextareaRenderable & {
  __oriVirtualLineCountPatch?: boolean
}

type CreateBufferOpentuiAdapterOptions = {
  tabWidth: number
  onLineInfoChange: () => void
  onCursorSync: () => void
}

export function createBufferOpentuiAdapter(options: CreateBufferOpentuiAdapterOptions) {
  let editorRef: TextareaRenderable | undefined
  let measuredRowVersion = -1
  let measuredRowWidth = 0
  let measuredRowHeight = 0
  let measuredRowCount = 1

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

    const wrap = <T extends keyof TextareaRuntimePatch["editorView"]>(key: T) => {
      const original = patch.editorView[key].bind(patch.editorView)
      patch.editorView[key] = ((...args: Parameters<TextareaRuntimePatch["editorView"][T]>) => {
        const result = original(...args)
        options.onCursorSync()
        return result
      }) as TextareaRuntimePatch["editorView"][T]
    }

    wrap("moveUpVisual")
    wrap("moveDownVisual")
    wrap("setViewport")
    wrap("setViewportSize")

    const originalOnSelectionChanged = patch.onSelectionChanged.bind(patch)
    patch.onSelectionChanged = ((selection: unknown) => {
      const result = originalOnSelectionChanged(selection)
      options.onCursorSync()
      return result
    }) as TextareaRuntimePatch["onSelectionChanged"]

    patch.__oriRuntimeSyncPatch = true
  }

  const attach = (node: TextareaRenderable | undefined) => {
    if (editorRef === node) {
      return
    }

    if (editorRef && editorRef !== node && !editorRef.isDestroyed) {
      editorRef.off("line-info-change", options.onLineInfoChange)
    }

    editorRef = node
    if (!node) {
      return
    }

    patchVirtualLineCount(node)
    patchRuntimeSync(node)
    applyRefTabWidth(node, options.tabWidth)
    node.on("line-info-change", options.onLineInfoChange)
  }

  const detach = () => {
    if (!editorRef || editorRef.isDestroyed) {
      editorRef = undefined
      return
    }

    editorRef.off("line-info-change", options.onLineInfoChange)
    editorRef = undefined
  }

  const readCursorState = () => {
    const ref = live()
    if (!ref) {
      return undefined
    }

    const cursor = ref.logicalCursor
    return {
      row: cursor.row,
      offset: docCharOffset(cursor.offset),
    } satisfies BufferCursorState
  }

  const totalVirtualRows = () => {
    const ref = live()
    if (!ref) {
      return 1
    }

    return Math.max(1, ref.editorView.getTotalVirtualLineCount(), ref.lineInfo.lineSources.length)
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

  return {
    attach,
    detach,
    live,
    readCursorState,
    totalVirtualRows,
    measureRows,
    resetMeasuredRows,
  }
}
