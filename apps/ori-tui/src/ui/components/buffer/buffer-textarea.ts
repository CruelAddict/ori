import type { TextareaRenderable } from "@opentui/core"
import { installCursorMovementHooks } from "./opentui-textarea-extensions/cursor-movement-hooks"
import { disableScroll } from "./opentui-textarea-extensions/internal-scroll"
import { enableLargeTextRead } from "./opentui-textarea-extensions/large-text-read"
import { addLogicalLineInfoCache, createLineInfoCache } from "./opentui-textarea-extensions/line-info-cache"
import { installSelectionHooks } from "./opentui-textarea-extensions/selection-hooks"
import {
  installSetViewportHooks,
  type SetViewportOptions,
  setTextareaViewport,
} from "./opentui-textarea-extensions/set-viewport-hooks"
import { installViewportSizeHooks } from "./opentui-textarea-extensions/viewport-size-hooks"
import { exposeVirtualLineCount } from "./opentui-textarea-extensions/virtual-line-count"
import { applyRefTabWidth } from "./text-metrics"

type CreateBufferTextareaOptions = {
  tabWidth: number
  onLineInfoChange: () => void
  onCursorSync: () => void
  onPreservePreferredVisualCol: () => void
}

export function createBufferTextarea(options: CreateBufferTextareaOptions) {
  let editorRef: TextareaRenderable | undefined
  const live = () => {
    if (!editorRef || editorRef.isDestroyed) {
      return undefined
    }

    return editorRef
  }
  const lineInfoCache = createLineInfoCache(live)

  const handleLineInfoChange = () => {
    lineInfoCache.clearLineInfoCache()
    options.onLineInfoChange()
  }

  const attach = (node: TextareaRenderable | undefined) => {
    if (editorRef === node) {
      return
    }

    if (editorRef && editorRef !== node && !editorRef.isDestroyed) {
      editorRef.off("line-info-change", handleLineInfoChange)
      lineInfoCache.clearLineInfoCache(editorRef)
    }

    editorRef = node
    if (!node) {
      return
    }

    exposeVirtualLineCount(node)
    addLogicalLineInfoCache(node, lineInfoCache)
    installSetViewportHooks(node, {
      beforeSetViewport: (event) => {
        if (event.previousViewport.width !== event.width) {
          lineInfoCache.clearLineInfoCache(event.ref)
        }
        if (event.moveCursor && event.notify) {
          options.onPreservePreferredVisualCol()
        }
      },
      afterSetViewport: (event) => {
        if (!event.notify) {
          return
        }
        if (
          // TODO: verify whether moveCursor needs unconditional sync, or cursor diff is enough.
          event.moveCursor ||
          event.cursorChanged
        ) {
          options.onCursorSync()
        }
      },
    })
    installViewportSizeHooks(node, {
      beforeViewportSizeChange: (event) => {
        if (event.previousViewport.width !== event.width) {
          lineInfoCache.clearLineInfoCache(event.ref)
        }
      },
      afterViewportSizeChange: () => {
        options.onCursorSync()
      },
    })
    installCursorMovementHooks(node, {
      beforeVisualMove: () => {
        options.onPreservePreferredVisualCol()
      },
      afterVisualMove: () => {
        options.onCursorSync()
      },
    })
    installSelectionHooks(node, {
      afterSelectionChange: () => {
        options.onCursorSync()
      },
    })
    disableScroll(node)
    enableLargeTextRead(node)
    applyRefTabWidth(node, options.tabWidth)
    node.on("line-info-change", handleLineInfoChange)
  }

  const detach = () => {
    if (!editorRef || editorRef.isDestroyed) {
      editorRef = undefined
      return
    }

    editorRef.off("line-info-change", handleLineInfoChange)
    lineInfoCache.clearLineInfoCache(editorRef)
    editorRef = undefined
  }

  const setViewport = (
    ref: TextareaRenderable,
    x: number,
    y: number,
    width: number,
    height: number,
    moveCursor = false,
    viewportOptions?: SetViewportOptions,
  ) => {
    setTextareaViewport(ref, x, y, width, height, moveCursor, viewportOptions)
  }

  return {
    attach,
    detach,
    live,
    getLineInfo: lineInfoCache.getLineInfo,
    clearLineInfoCache: lineInfoCache.clearLineInfoCache,
    setViewport,
  }
}
