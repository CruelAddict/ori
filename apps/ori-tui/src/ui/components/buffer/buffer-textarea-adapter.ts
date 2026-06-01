import type { SyntaxStyle, TextareaRenderable, WidthMethod } from "@opentui/core"
import { type DisplayColumn, displayColumn, type LineIndex, lineIndex } from "./coords"
import { installCursorMovementHooks } from "./opentui-textarea-extensions/cursor-movement-hooks"
import { disableScroll } from "./opentui-textarea-extensions/disable-scroll"
import { enableLargeTextRead } from "./opentui-textarea-extensions/large-text-read"
import { createTextareaLineInfoCache } from "./opentui-textarea-extensions/line-info-cache"
import { installSelectionHooks, type SelectionChangeEvent } from "./opentui-textarea-extensions/selection-hooks"
import {
  installSetViewportHooks,
  type SetViewport,
  type SetViewportResult,
} from "./opentui-textarea-extensions/set-viewport-hooks"
import { installViewportSizeHooks } from "./opentui-textarea-extensions/viewport-size-hooks"
import { exposeVirtualLineCount } from "./opentui-textarea-extensions/virtual-line-count"
import { createTextareaRenderTarget, type RenderTarget } from "./render-target"
import { applyRefTabWidth } from "./text-metrics"

type CreateBufferTextareaAdapterOptions = {
  tabWidth: number
  onVisualLayoutChange: () => void
  onTextareaCursorChanged: (event: BufferTextareaCursorChangeEvent) => void
  onTextareaSelectionChange: (event: SelectionChangeEvent) => void
  onTextareaViewportChange: (event: BufferTextareaViewportChange) => void
  onVisualCursorMoveStart: () => void
  onVisualCursorMoveEnd: () => void
}

export type BufferTextareaAdapterCursor = {
  logicalRow: number
  logicalCol: number
  visualRow: number
  visualCol: number
}

export type BufferTextareaBox = {
  x: number
  y: number
  width: number
  rows: number
  top: number
}

export type BufferTextareaViewport = {
  left: number
  top: number
  width: number
  rows: number
}

export type BufferTextareaViewportChange = {
  top: number
  cursorMoved: boolean
}

export type BufferTextareaCursorChangeCause = "input" | "scroll"

export type BufferTextareaCursorChangeEvent = {
  cause: BufferTextareaCursorChangeCause
  keepStickyVisualColumn?: boolean
}

export type BufferTextareaVisualLayout = {
  sourceLines: readonly LineIndex[]
  lineStartColumns: readonly DisplayColumn[]
  lineWidths: readonly DisplayColumn[]
}

export function createBufferTextareaAdapter(options: CreateBufferTextareaAdapterOptions) {
  let editorRef: TextareaRenderable | undefined
  let measuredRowWidth = 0
  let measuredRowHeight = 0
  let measuredRowCount = 1
  let cursorChangeCause: BufferTextareaCursorChangeCause = "input"

  const ref = () => {
    if (!editorRef || editorRef.isDestroyed) {
      return undefined
    }

    return editorRef
  }

  const lineInfo = createTextareaLineInfoCache(ref)

  const withCursorChangeCause = <T>(cause: BufferTextareaCursorChangeCause, callback: () => T) => {
    const previous = cursorChangeCause
    cursorChangeCause = cause
    const result = callback()
    cursorChangeCause = previous
    return result
  }

  const emitCursorChange = (event: Omit<BufferTextareaCursorChangeEvent, "cause"> = {}) => {
    options.onTextareaCursorChanged({
      ...event,
      cause: cursorChangeCause,
    })
  }

  const resetMeasurements = () => {
    measuredRowWidth = 0
    measuredRowHeight = 0
    measuredRowCount = 1
  }

  const measureContentRows = (viewportRows: number) => {
    const node = ref()
    if (!node) {
      return 1
    }

    const width = Math.max(1, node.width)
    const height = Math.max(1, viewportRows)
    if (measuredRowWidth === width && measuredRowHeight === height) {
      return measuredRowCount
    }

    const measured = node.editorView.measureForDimensions(width, height)?.lineCount
    measuredRowWidth = width
    measuredRowHeight = height
    measuredRowCount = Math.max(1, measured ?? node.editorView.getTotalVirtualLineCount() ?? 0)
    return measuredRowCount
  }

  const handleLineInfoChange = () => {
    lineInfo.clear()
    resetMeasurements()
    options.onVisualLayoutChange()
  }

  const detachFromCurrentRef = (node: TextareaRenderable) => {
    node.onCursorChange = undefined
    node.off("line-info-change", handleLineInfoChange)
    lineInfo.clear(node)
    resetMeasurements()
  }

  const installLineInfo = (node: TextareaRenderable) => {
    lineInfo.attach(node)
    node.on("line-info-change", handleLineInfoChange)
  }

  const installViewport = (node: TextareaRenderable) => {
    installSetViewportHooks(node, {
      beforeSetViewport: (event) => {
        if (event.previousViewport.width !== event.width) {
          lineInfo.clear(event.ref)
          resetMeasurements()
        }
      },
      afterSetViewport: (event) => {
        if (event.source === "buffer") {
          return
        }

        options.onTextareaViewportChange({
          top: event.y,
          cursorMoved: event.moveCursor || event.cursorChanged,
        })
        if (event.moveCursor || event.cursorChanged) {
          emitCursorChange()
        }
      },
    })
    installViewportSizeHooks(node, {
      beforeViewportSizeChange: (event) => {
        if (event.previousViewport.width !== event.width) {
          lineInfo.clear(event.ref)
          resetMeasurements()
        }
      },
      afterViewportSizeChange: () => {
        emitCursorChange()
      },
    })
  }

  const installCursorHooks = (node: TextareaRenderable) => {
    node.onCursorChange = () => {
      emitCursorChange()
    }
    installCursorMovementHooks(node, {
      beforeVisualMove: () => {
        options.onVisualCursorMoveStart()
      },
      afterVisualMove: () => {
        emitCursorChange({ keepStickyVisualColumn: true })
        options.onVisualCursorMoveEnd()
      },
    })
    installSelectionHooks(node, {
      beforeSelectionChange: (event) => {
        options.onTextareaSelectionChange(event)
      },
      afterSelectionChange: (event) => {
        options.onTextareaSelectionChange(event)
        emitCursorChange()
      },
    })
  }

  const installOpenTuiPatches = (node: TextareaRenderable) => {
    disableScroll(node)
    enableLargeTextRead(node)
    applyRefTabWidth(node, options.tabWidth)
  }

  const attach = (node: TextareaRenderable | undefined) => {
    if (editorRef === node) {
      return
    }

    if (editorRef && editorRef !== node && !editorRef.isDestroyed) {
      detachFromCurrentRef(editorRef)
    }

    editorRef = node
    if (!node) {
      return
    }

    exposeVirtualLineCount(node)
    installLineInfo(node)
    installViewport(node)
    installCursorHooks(node)
    installOpenTuiPatches(node)
  }

  const detach = () => {
    if (!editorRef || editorRef.isDestroyed) {
      editorRef = undefined
      return
    }

    detachFromCurrentRef(editorRef)
    editorRef = undefined
  }

  const moveViewport = (
    viewport: BufferTextareaViewport,
    moveCursor = false,
    cause: BufferTextareaCursorChangeCause = "input",
  ): SetViewportResult | undefined => {
    const node = ref()
    if (!node) {
      return undefined
    }

    const set = node.editorView.setViewport as SetViewport
    return withCursorChangeCause(cause, () => {
      return set(viewport.left, viewport.top, viewport.width, viewport.rows, moveCursor, { source: "buffer" })
    })
  }

  return {
    attach,
    detach,
    isAttached: (node: TextareaRenderable) => ref() === node,
    focus: () => ref()?.focus(),
    blur: () => ref()?.blur(),
    setCursorVisible: (visible: boolean) => {
      const node = ref()
      if (node) {
        node.showCursor = visible
      }
    },
    setLive: (live: boolean) => {
      const node = ref()
      if (node) {
        node.live = live
      }
    },
    setScrollSpeed: (speed: number) => {
      const node = ref()
      if (node) {
        node.scrollSpeed = speed
      }
    },
    setText: (text: string) => {
      resetMeasurements()
      ref()?.setText(text)
    },
    insertText: (text: string) => {
      resetMeasurements()
      ref()?.insertText(text)
    },
    requestRender: () => ref()?.requestRender(),
    setSyntaxStyle: (style: SyntaxStyle | null) => {
      const node = ref()
      if (node) {
        node.syntaxStyle = style
      }
    },
    readText: () => ref()?.plainText,
    readVisualLayout: (): BufferTextareaVisualLayout | undefined => {
      const node = ref()
      const info = node ? lineInfo.read(node) : undefined
      if (!info) {
        return undefined
      }

      return {
        sourceLines: info.lineSources.map(lineIndex),
        lineStartColumns: info.lineStartCols.map(displayColumn),
        lineWidths: info.lineWidthCols.map(displayColumn),
      }
    },
    clearVisualLayout: () => {
      lineInfo.clear()
      resetMeasurements()
    },
    readCursor: (): BufferTextareaAdapterCursor | undefined => {
      const node = ref()
      if (!node) {
        return undefined
      }

      return {
        logicalRow: node.logicalCursor.row,
        logicalCol: node.logicalCursor.col,
        visualRow: node.visualCursor.visualRow,
        visualCol: node.visualCursor.visualCol,
      }
    },
    readBox: (): BufferTextareaBox | undefined => {
      const node = ref()
      if (!node) {
        return undefined
      }

      return {
        x: node.x,
        y: node.y,
        width: node.width,
        rows: node.height,
        top: node.scrollY,
      }
    },
    readViewport: (): BufferTextareaViewport | undefined => {
      const viewport = ref()?.editorView.getViewport()
      return viewport
        ? {
            left: viewport.offsetX,
            top: viewport.offsetY,
            width: viewport.width,
            rows: viewport.height,
          }
        : undefined
    },
    getWidthMethod: (): WidthMethod | undefined => ref()?.ctx?.widthMethod,
    measureContentRows,
    resetMeasurements,
    setScrollMargin: (margin: number) => ref()?.editorView.setScrollMargin(margin),
    setCursor: (row: number, col: number, cause: BufferTextareaCursorChangeCause = "input") => {
      withCursorChangeCause(cause, () => ref()?.editBuffer.setCursor(row, col))
    },
    deleteRange: (startRow: number, startCol: number, endRow: number, endCol: number) => {
      resetMeasurements()
      ref()?.editBuffer.deleteRange(startRow, startCol, endRow, endCol)
    },
    createRenderTarget: (): RenderTarget | undefined => {
      const node = ref()
      return node ? createTextareaRenderTarget(node) : undefined
    },
    moveViewport,
  }
}

export type BufferTextarea = ReturnType<typeof createBufferTextareaAdapter>
