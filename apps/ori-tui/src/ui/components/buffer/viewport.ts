import type { ScrollBoxRenderable, Selection } from "@opentui/core"
import { getViewportBandY, getViewportInsetY, getViewportRect } from "@ui/components/ori-scrollbox"
import { createSignal } from "solid-js"
import type {
  BufferTextarea,
  BufferTextareaCursorChangeCause,
  BufferTextareaCursorChangeEvent,
  BufferTextareaViewportChange,
} from "./buffer-textarea-adapter"
import { type DocCharOffset, lineIndex } from "./coords"
import type { SelectionChangeEvent } from "./opentui-textarea-extensions/selection-hooks"
import type { TextGeometry } from "./text-geometry"
import { resolveViewportOffsetPoint, resolveVisualCursorDocOffset } from "./viewport-geometry"
import type { ViewportSnapshot } from "./viewport-snapshot"

export type { ViewportPoint } from "./viewport-geometry"

const DEFAULT_SELECTION_DRAG_SCROLL_SPEED = 16
const SELECTION_DRAG_MEDIUM_DISTANCE = 2
const SELECTION_DRAG_FAST_DISTANCE = 3

type CursorStateCaptureOptions = {
  keepStickyVisualColumn?: boolean
}

export type ViewportCursorState = {
  row: number
  offset: DocCharOffset | undefined
}

type ViewportChange = {
  applied: boolean
  cursorChanged: boolean
}

type CreateViewportOptions = {
  textarea: BufferTextarea
  geometry: TextGeometry
  updateCursorFromTextarea: (event: BufferTextareaCursorChangeEvent) => void
}

export function createViewport(options: CreateViewportOptions) {
  const [rows, setRows] = createSignal({ viewport: 1, content: 1 })
  let scrollboxRef: ScrollBoxRenderable | undefined
  let pendingTextareaTop: number | undefined
  let pendingUserScroll = false
  let scrollboxWidth = 0
  let scrollboxRows = 0
  let stickyVisualColumn: number | undefined
  let holdStickyVisualColumn = false
  let scrollStickyVisualColumn: number | undefined
  let scrollStickyVisualColumnResetTimer: ReturnType<typeof setTimeout> | undefined

  const measureContentRows = (viewportRows: number) => {
    return Math.max(viewportRows, options.textarea.measureContentRows(viewportRows))
  }

  const resizeRows = (viewportRows: number, contentRows: number) => {
    setRows((current) => {
      if (current.viewport === viewportRows && current.content === contentRows) {
        return current
      }

      return { viewport: viewportRows, content: contentRows }
    })
  }

  const updateScrollbarMetrics = () => {
    if (!scrollboxRef) {
      return
    }

    scrollboxRef.verticalScrollBar.scrollSize = scrollboxRef.scrollHeight
    scrollboxRef.verticalScrollBar.viewportSize = scrollboxRef.viewport.height
    scrollboxRef.horizontalScrollBar.scrollSize = scrollboxRef.scrollWidth
    scrollboxRef.horizontalScrollBar.viewportSize = scrollboxRef.viewport.width
  }

  const moveScrollboxToTextareaTop = (top: number) => {
    if (!scrollboxRef) {
      return
    }
    // Textarea owns the rendered rows; scrollbox only supplies scrollbar input/chrome.
    scrollboxRef.content.translateY = 0
    if ((scrollboxRef.scrollTop ?? 0) === top) {
      return
    }

    scrollboxRef.scrollTo({ x: 0, y: top })
    scrollboxRef.content.translateY = 0
  }

  const clearScrollStickyVisualColumn = () => {
    if (scrollStickyVisualColumnResetTimer !== undefined) {
      clearTimeout(scrollStickyVisualColumnResetTimer)
      scrollStickyVisualColumnResetTimer = undefined
    }
    scrollStickyVisualColumn = undefined
  }

  const resetCursorTracking = () => {
    clearScrollStickyVisualColumn()
    stickyVisualColumn = undefined
  }

  const startVisualCursorMove = () => {
    holdStickyVisualColumn = true
  }

  const endVisualCursorMove = () => {
    holdStickyVisualColumn = false
  }

  const rememberScrollStickyColumn = () => {
    const cursor = options.textarea.readCursor()
    if (!cursor) {
      return
    }

    scrollStickyVisualColumn ??= stickyVisualColumn ?? cursor.visualCol
    if (scrollStickyVisualColumnResetTimer !== undefined) {
      clearTimeout(scrollStickyVisualColumnResetTimer)
    }
    scrollStickyVisualColumnResetTimer = setTimeout(() => {
      scrollStickyVisualColumnResetTimer = undefined
      scrollStickyVisualColumn = undefined
    }, 120)
  }

  const applyViewportChange = (
    x: number,
    y: number,
    width: number,
    height: number,
    moveCursor = false,
    cause: BufferTextareaCursorChangeCause = "input",
  ) => {
    let cursorChanged = false
    const viewport = options.textarea.readViewport()
    const cursor = options.textarea.readCursor()
    if (!viewport || !cursor) {
      return cursorChanged
    }

    const currentRow = viewport.top + cursor.visualRow
    const targetVisualCol = scrollStickyVisualColumn ?? stickyVisualColumn ?? cursor.visualCol

    if (!moveCursor) {
      return Boolean(
        options.textarea.moveViewport({ left: x, top: y, width, rows: height }, false, cause)?.cursorChanged,
      )
    }

    const firstLayout = options.textarea.readVisualLayout()
    if (!firstLayout) {
      return cursorChanged
    }

    cursorChanged =
      cursorChanged ||
      Boolean(options.textarea.moveViewport({ left: x, top: y, width, rows: height }, false, cause)?.cursorChanged)

    let nextViewport = options.textarea.readViewport()
    if (!nextViewport) {
      return cursorChanged
    }
    if (nextViewport.top !== y) {
      const layout = firstLayout
      const proxyOffset = resolveVisualCursorDocOffset({
        geometry: options.geometry,
        visualRow: Math.max(0, Math.min(y + cursor.visualRow, layout.sourceLines.length - 1)),
        visualCol: targetVisualCol,
        layout,
      })
      if (proxyOffset !== undefined) {
        const document = options.geometry.document
        const proxy = document.positionAtOffset(proxyOffset)
        const nextCursor = options.textarea.readCursor()
        if (!nextCursor || nextCursor.logicalRow !== proxy.line || nextCursor.logicalCol !== proxy.offset) {
          options.textarea.setCursor(proxy.line, proxy.offset, cause)
          cursorChanged = true
        }
      }
      const viewportChange = options.textarea.moveViewport({ left: x, top: y, width, rows: height }, false, cause)
      cursorChanged = cursorChanged || Boolean(viewportChange?.cursorChanged)
      nextViewport = options.textarea.readViewport()
      if (!nextViewport) {
        return cursorChanged
      }
    }

    const bandY = getViewportBandY({ height })
    const nextVisualRow = currentRow - nextViewport.top
    const layout = options.textarea.readVisualLayout()
    if (!layout) {
      return cursorChanged
    }
    const maxRow = Math.max(0, layout.sourceLines.length - 1)
    const targetRow = Math.max(
      0,
      Math.min(
        nextVisualRow < bandY.start
          ? nextViewport.top + bandY.start
          : nextVisualRow > bandY.end
            ? nextViewport.top + bandY.end
            : currentRow,
        maxRow,
      ),
    )
    const resolvedRow =
      targetRow === currentRow && nextViewport.top !== y
        ? Math.max(0, Math.min(currentRow + (y - nextViewport.top), maxRow))
        : targetRow

    if (resolvedRow === currentRow) {
      return cursorChanged
    }

    const nextOffset = resolveVisualCursorDocOffset({
      geometry: options.geometry,
      visualRow: resolvedRow,
      visualCol: targetVisualCol,
      layout,
    })
    if (nextOffset === undefined) {
      return cursorChanged
    }

    const document = options.geometry.document
    const next = document.positionAtOffset(nextOffset)
    const nextCursor = options.textarea.readCursor()
    if (!nextCursor || nextCursor.logicalRow !== next.line || nextCursor.logicalCol !== next.offset) {
      options.textarea.setCursor(next.line, next.offset, cause)
      cursorChanged = true
      const cursorViewport = options.textarea.readViewport()
      if (cursorViewport && cursorViewport.top !== nextViewport.top) {
        const viewportChange = options.textarea.moveViewport(
          { left: x, top: nextViewport.top, width, rows: height },
          false,
          cause,
        )
        cursorChanged = cursorChanged || Boolean(viewportChange?.cursorChanged)
      }
    }
    return cursorChanged
  }

  const captureCursorState = (captureOptions: CursorStateCaptureOptions = {}) => {
    const cursor = options.textarea.readCursor()
    if (!cursor) {
      return undefined
    }

    if (!holdStickyVisualColumn && !captureOptions.keepStickyVisualColumn && scrollStickyVisualColumn === undefined) {
      stickyVisualColumn = cursor.visualCol
    }
    const document = options.geometry.document
    return {
      row: cursor.logicalRow,
      offset: document.offsetAtLineChar(cursor.logicalRow, cursor.logicalCol),
    } satisfies ViewportCursorState
  }

  const snapshot = () => {
    const box = options.textarea.readBox()
    const cursor = options.textarea.readCursor()
    const layout = options.textarea.readVisualLayout()
    if (!box || !cursor || !layout) {
      return undefined
    }

    return {
      geometry: options.geometry,
      layout,
      scrollY: box.top,
      height: box.rows,
      focusedLine: lineIndex(cursor.logicalRow),
    } satisfies ViewportSnapshot
  }

  const moveViewport = (
    x: number,
    y: number,
    width: number,
    height: number,
    moveCursor = false,
    cause: BufferTextareaCursorChangeCause = "input",
  ): ViewportChange => {
    const viewport = options.textarea.readViewport()
    if (!viewport) {
      return { applied: false, cursorChanged: false }
    }

    if (viewport.width !== width) {
      options.textarea.clearVisualLayout()
    }
    return {
      applied: true,
      cursorChanged: applyViewportChange(x, y, width, height, moveCursor, cause),
    }
  }

  const resolveViewportPoint = (offset: DocCharOffset) => {
    const box = options.textarea.readBox()
    const layout = options.textarea.readVisualLayout()
    if (!box || !layout) {
      return null
    }

    return resolveViewportOffsetPoint({
      geometry: options.geometry,
      offset,
      layout,
      scrollY: box.top,
      viewportHeight: box.rows,
    })
  }

  const resizeTextareaViewport = (
    top: number,
    nextRows = options.textarea.readBox()?.rows ?? 1,
    moveCursor = false,
  ) => {
    const box = options.textarea.readBox()
    const textareaViewport = options.textarea.readViewport()
    if (!box || !textareaViewport) {
      return
    }

    const viewportRows = Math.max(1, nextRows)
    const viewportWidth = Math.max(1, box.width)
    const margin = getViewportInsetY({ height: viewportRows }) / viewportRows
    options.textarea.setScrollMargin(margin)
    const nextTop = Math.max(0, Math.min(top, Math.max(0, measureContentRows(viewportRows) - viewportRows)))
    if (
      textareaViewport.top === nextTop &&
      textareaViewport.width === viewportWidth &&
      textareaViewport.rows === viewportRows
    ) {
      pendingTextareaTop = undefined
      resizeRows(viewportRows, measureContentRows(viewportRows))
      moveScrollboxToTextareaTop(box.top)
      return
    }

    pendingTextareaTop = moveCursor ? nextTop : undefined
    const cause = moveCursor ? "scroll" : "input"
    const change = moveViewport(textareaViewport.left, nextTop, viewportWidth, viewportRows, moveCursor, cause)
    if (moveCursor || change.cursorChanged) {
      options.updateCursorFromTextarea({ cause, keepStickyVisualColumn: moveCursor })
    }
    options.textarea.requestRender()
    const nextBox = options.textarea.readBox()
    if (!moveCursor && scrollboxRef && nextBox && (scrollboxRef.scrollTop ?? 0) !== nextBox.top) {
      scrollboxRef.scrollTo({ x: 0, y: nextBox.top })
    }
  }

  const renderScrollboxFromTextarea = () => {
    const box = options.textarea.readBox()
    if (!scrollboxRef || !box) {
      return
    }

    updateScrollbarMetrics()
    const viewport = getViewportRect(scrollboxRef)
    const viewportRows = Math.max(1, viewport.height)
    const maxTop = Math.max(0, measureContentRows(viewportRows) - viewportRows)
    if (pendingTextareaTop !== undefined && box.top === pendingTextareaTop) {
      pendingTextareaTop = undefined
    }
    if (box.top > maxTop) {
      resizeTextareaViewport(maxTop, viewportRows)
      return
    }

    const margin = getViewportInsetY({ height: viewportRows }) / viewportRows
    options.textarea.setScrollMargin(margin)
    resizeRows(viewportRows, measureContentRows(viewportRows))
    moveScrollboxToTextareaTop(box.top)
  }

  const applyPendingUserScroll = () => {
    if (!pendingUserScroll) {
      return false
    }

    pendingUserScroll = false
    if (!scrollboxRef) {
      return false
    }

    updateScrollbarMetrics()
    const viewport = getViewportRect(scrollboxRef)
    const viewportRows = Math.max(1, viewport.height)
    resizeRows(viewportRows, measureContentRows(viewportRows))
    const nextTop = scrollboxRef.scrollTop ?? 0
    let moveCursor = true
    const textareaViewport = options.textarea.readViewport()
    const cursor = options.textarea.readCursor()
    if (textareaViewport && cursor) {
      const currentRow = textareaViewport.top + cursor.visualRow
      const band = getViewportBandY({ height: viewport.height })
      moveCursor = currentRow < nextTop + band.start || currentRow > nextTop + band.end
    }
    resizeTextareaViewport(nextTop, viewport.height, moveCursor)
    scrollboxRef.content.translateY = 0
    return true
  }

  const attachScrollbox = (node: ScrollBoxRenderable | undefined) => {
    scrollboxRef = node
    const viewport = node ? getViewportRect(node) : null
    scrollboxWidth = viewport?.width ?? 0
    scrollboxRows = viewport?.height ?? 0
  }

  const isScrollboxAttached = (node: ScrollBoxRenderable) => scrollboxRef === node

  const requestUserScroll = () => {
    if (pendingUserScroll) {
      return false
    }

    rememberScrollStickyColumn()
    pendingUserScroll = true
    return true
  }

  const handleTextareaMouseScroll = () => {
    rememberScrollStickyColumn()
  }

  const handleScrollboxStateChange = () => {
    if (!scrollboxRef) {
      return false
    }

    // Scrollbox can also receive drag events; textarea owns selection autoscroll here.
    scrollboxRef.stopAutoScroll()
    scrollboxRef.content.translateY = 0
    updateScrollbarMetrics()
    if (pendingUserScroll) {
      return false
    }

    const viewport = getViewportRect(scrollboxRef)
    if (viewport.width !== scrollboxWidth || viewport.height !== scrollboxRows) {
      scrollboxWidth = viewport.width
      scrollboxRows = viewport.height
      return true
    }

    const box = options.textarea.readBox()
    if (!box) {
      return false
    }

    if (pendingTextareaTop !== undefined) {
      if (box.top === pendingTextareaTop) {
        pendingTextareaTop = undefined
        return true
      }
      if ((scrollboxRef.scrollTop ?? 0) === pendingTextareaTop) {
        return false
      }
      pendingTextareaTop = undefined
    }

    if ((scrollboxRef.scrollTop ?? 0) !== box.top) {
      moveScrollboxToTextareaTop(box.top)
    }
    return false
  }

  const handleTextareaViewportChange = (event: BufferTextareaViewportChange) => {
    moveScrollboxToTextareaTop(event.top)
  }

  const adjustSelectionDragSpeed = (selection: Selection) => {
    const box = options.textarea.readBox()
    if (!box) {
      return
    }

    const focus = selection.focus
    const maxY = box.y + Math.max(0, box.rows - 1)
    const distance = Math.max(box.y - focus.y, focus.y - maxY, 0)
    const speed =
      distance >= SELECTION_DRAG_FAST_DISTANCE
        ? DEFAULT_SELECTION_DRAG_SCROLL_SPEED * 4
        : distance >= SELECTION_DRAG_MEDIUM_DISTANCE
          ? DEFAULT_SELECTION_DRAG_SCROLL_SPEED * 2
          : DEFAULT_SELECTION_DRAG_SCROLL_SPEED
    options.textarea.setScrollSpeed(speed)
  }

  const clampSelectionDragFocus = (selection: Selection) => {
    const box = options.textarea.readBox()
    if (!box) {
      return
    }

    const focus = selection.focus
    selection.focus = {
      x: Math.max(box.x, Math.min(focus.x, box.x + Math.max(0, box.width - 1))),
      y: Math.max(box.y, Math.min(focus.y, box.y + Math.max(0, box.rows - 1))),
    }
  }

  const finishSelectionDrag = () => {
    const box = options.textarea.readBox()
    if (box) {
      moveScrollboxToTextareaTop(box.top)
    }
    options.textarea.setCursorVisible(true)
    options.textarea.setLive(false)
    options.textarea.setScrollSpeed(DEFAULT_SELECTION_DRAG_SCROLL_SPEED)
    options.updateCursorFromTextarea({ cause: "input" })
  }

  const handleTextareaSelectionChange = (event: SelectionChangeEvent) => {
    const before = event.result === undefined
    const selection = event.selection
    if (before && selection?.isDragging) {
      adjustSelectionDragSpeed(selection)
      clampSelectionDragFocus(selection)
    }

    const dragging = Boolean(selection?.isDragging)
    if (before) {
      if (!dragging) {
        return
      }

      // OpenTUI applies selection autoscroll from onUpdate, so it must stay live while the mouse is held.
      options.textarea.setLive(true)
      options.textarea.setCursorVisible(false)
      return
    }

    if (!dragging) {
      finishSelectionDrag()
    }
  }

  const dispose = () => {
    pendingUserScroll = false
    clearScrollStickyVisualColumn()
    options.textarea.setLive(false)
    options.textarea.setScrollSpeed(DEFAULT_SELECTION_DRAG_SCROLL_SPEED)
  }

  return {
    viewportRows: () => rows().viewport,
    contentRows: () => rows().content,
    isSelecting: () => Boolean(scrollboxRef?.ctx.getSelection()?.isDragging),
    attachScrollbox,
    isScrollboxAttached,
    captureCursorState,
    snapshot,
    startVisualCursorMove,
    endVisualCursorMove,
    resetCursorTracking,
    moveViewport,
    requestUserScroll,
    applyPendingUserScroll,
    handleTextareaMouseScroll,
    handleScrollboxStateChange,
    handleTextareaViewportChange,
    handleTextareaSelectionChange,
    finishSelectionDrag,
    renderScrollboxFromTextarea,
    resolveViewportPoint,
    dispose,
  }
}
