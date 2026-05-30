import type { LineInfo, SyntaxStyle, TextareaRenderable, WidthMethod } from "@opentui/core"
import { installCursorMovementHooks } from "./opentui-textarea-extensions/cursor-movement-hooks"
import { disableScroll } from "./opentui-textarea-extensions/disable-scroll"
import { enableLargeTextRead } from "./opentui-textarea-extensions/large-text-read"
import { createTextareaLineInfoCache } from "./opentui-textarea-extensions/line-info-cache"
import { installSelectionHooks } from "./opentui-textarea-extensions/selection-hooks"
import {
  installSetViewportHooks,
  type SetViewportResult,
  setViewportAndReadCursorChange,
} from "./opentui-textarea-extensions/set-viewport-hooks"
import { installViewportSizeHooks } from "./opentui-textarea-extensions/viewport-size-hooks"
import { exposeVirtualLineCount } from "./opentui-textarea-extensions/virtual-line-count"
import { createTextareaRenderTarget, type RenderTarget } from "./render-target"
import { applyRefTabWidth } from "./text-metrics"

type CreateBufferTextareaOptions = {
  tabWidth: number
  onLineInfoChange: () => void
  onTextareaCursorChanged: () => void
  onBeforeVisualCursorMove: () => void
}

export type BufferTextareaCursor = {
  logicalRow: number
  logicalCol: number
  visualRow: number
  visualCol: number
}

export type BufferTextareaMetrics = {
  x: number
  y: number
  width: number
  height: number
  scrollY: number
}

export type BufferTextareaViewport = ReturnType<TextareaRenderable["editorView"]["getViewport"]>

export function createBufferTextarea(options: CreateBufferTextareaOptions) {
  let editorRef: TextareaRenderable | undefined

  const ref = () => {
    if (!editorRef || editorRef.isDestroyed) {
      return undefined
    }

    return editorRef
  }

  const lineInfo = createTextareaLineInfoCache(ref)

  const handleLineInfoChange = () => {
    lineInfo.clear()
    options.onLineInfoChange()
  }

  const detachFromCurrentRef = (node: TextareaRenderable) => {
    node.off("line-info-change", handleLineInfoChange)
    lineInfo.clear(node)
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
        }
      },
      afterSetViewport: (event) => {
        if (event.moveCursor || event.cursorChanged) {
          options.onTextareaCursorChanged()
        }
      },
    })
    installViewportSizeHooks(node, {
      beforeViewportSizeChange: (event) => {
        if (event.previousViewport.width !== event.width) {
          lineInfo.clear(event.ref)
        }
      },
      afterViewportSizeChange: () => {
        options.onTextareaCursorChanged()
      },
    })
  }

  const installCursorHooks = (node: TextareaRenderable) => {
    installCursorMovementHooks(node, {
      beforeVisualMove: () => {
        options.onBeforeVisualCursorMove()
      },
      afterVisualMove: () => {
        options.onTextareaCursorChanged()
      },
    })
    installSelectionHooks(node, {
      afterSelectionChange: () => {
        options.onTextareaCursorChanged()
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

  const setViewport = (
    x: number,
    y: number,
    width: number,
    height: number,
    moveCursor = false,
  ): SetViewportResult | undefined => {
    const node = ref()
    if (!node) {
      return undefined
    }

    return setViewportAndReadCursorChange(node, x, y, width, height, moveCursor)
  }

  return {
    attach,
    detach,
    isAttached: (node: TextareaRenderable) => ref() === node,
    focus: () => ref()?.focus(),
    blur: () => ref()?.blur(),
    setText: (text: string) => ref()?.setText(text),
    insertText: (text: string) => ref()?.insertText(text),
    requestRender: () => ref()?.requestRender(),
    setSyntaxStyle: (style: SyntaxStyle | null) => {
      const node = ref()
      if (node) {
        node.syntaxStyle = style
      }
    },
    readText: () => ref()?.plainText,
    readLineInfo: (): LineInfo | undefined => {
      const node = ref()
      return node ? lineInfo.read(node) : undefined
    },
    clearLineInfo: () => lineInfo.clear(),
    readCursor: (): BufferTextareaCursor | undefined => {
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
    readMetrics: (): BufferTextareaMetrics | undefined => {
      const node = ref()
      if (!node) {
        return undefined
      }

      return {
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        scrollY: node.scrollY,
      }
    },
    readViewport: (): BufferTextareaViewport | undefined => ref()?.editorView.getViewport(),
    getWidthMethod: (): WidthMethod | undefined => ref()?.ctx?.widthMethod,
    getTotalVirtualRows: () => ref()?.editorView.getTotalVirtualLineCount(),
    measureRows: (width: number, height: number) => ref()?.editorView.measureForDimensions(width, height)?.lineCount,
    setScrollMargin: (margin: number) => ref()?.editorView.setScrollMargin(margin),
    setCursor: (row: number, col: number) => ref()?.editBuffer.setCursor(row, col),
    deleteRange: (startRow: number, startCol: number, endRow: number, endCol: number) => {
      ref()?.editBuffer.deleteRange(startRow, startCol, endRow, endCol)
    },
    createRenderTarget: (): RenderTarget | undefined => {
      const node = ref()
      return node ? createTextareaRenderTarget(node) : undefined
    },
    setViewport,
  }
}
