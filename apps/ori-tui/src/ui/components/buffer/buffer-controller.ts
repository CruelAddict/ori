import type {
  BoxRenderable,
  LineNumberRenderable,
  MouseEvent,
  ScrollBoxRenderable,
  Selection,
  TextareaRenderable,
} from "@opentui/core"
import { getViewportBandY, getViewportInsetY, getViewportRect } from "@ui/components/ori-scrollbox"
import type { SelectPopupAnchor } from "@ui/components/select-popup-model"
import { debounce } from "@utils/debounce"
import { type Accessor, createEffect, createSignal, on, onCleanup, onMount } from "solid-js"
import { type BufferAnalysis, createAnalysisHighlightLayer } from "./analysis"
import { createBufferAutocomplete } from "./autocomplete/controller"
import type { BufferAutocompleteProvider } from "./autocomplete/types"
import { createBufferEditCommands, getDeleteToLineStartEdit } from "./buffer-edit-commands"
import { createBufferTextareaAdapter } from "./buffer-textarea-adapter"
import { createBufferViewportController } from "./buffer-viewport-controller"
import { type DocCharOffset, docCharOffset, type LineIndex, lineIndex } from "./coords"
import { type BufferTextChange, Document, findTextChange, normalizeDocumentText } from "./document"
import type { SelectionChangeEvent } from "./opentui-textarea-extensions/selection-hooks"
import type { SetViewportAfterEvent } from "./opentui-textarea-extensions/set-viewport-hooks"
import { createTextGeometry } from "./text-geometry"

const DEBOUNCE_MS = 200
const DEFAULT_TAB_WIDTH = 2
const EMPTY_GUTTER_MARKERS = new Map<number, string>()
const DEFAULT_SELECTION_DRAG_SCROLL_SPEED = 16
const SELECTION_DRAG_MEDIUM_DISTANCE = 2
const SELECTION_DRAG_FAST_DISTANCE = 3

type PendingChangeOrigin = {
  origin: "user" | "autocomplete"
  remainingEvents: number
}

type BufferPalette = Accessor<{
  get: (name: string) => string
}>

export type BufferApi = {
  setText: (text: string) => void
  focus: () => void
  getCursorOffset: () => DocCharOffset | undefined
}

export type BufferCursor =
  | {
      line: LineIndex
      offset: DocCharOffset
    }
  | undefined

export type BufferState = {
  document: Document
  cursor: BufferCursor
}

export type BufferProps = {
  initialText: string
  tabWidth?: number
  isFocused: Accessor<boolean>
  onTextChange: (text: string, info: { modified: boolean }) => void
  onUnfocus?: () => void
  registerApi?: (api: BufferApi) => void
  focusSelf: () => void
  gutterMarkers?: Accessor<ReadonlyMap<number, string>>
  onStateChange?: (state: BufferState) => void
  autocomplete?: BufferAutocompleteProvider
  analysis?: BufferAnalysis
}

export function createBufferController(props: BufferProps, palette: BufferPalette) {
  const tabWidth = Math.max(1, props.tabWidth ?? DEFAULT_TAB_WIDTH)
  const [doc, setDoc] = createSignal(Document.create(props.initialText))

  const [layoutState, setLayoutState] = createSignal({ viewportHeight: 1, totalRows: 1 })

  const [cursorState, setCursorState] = createSignal<BufferCursor>({
    line: lineIndex(0),
    offset: docCharOffset(0),
  })

  let scrollRef: ScrollBoxRenderable | undefined
  let bufferRootRef: BoxRenderable | undefined
  let gutterRef: LineNumberRenderable | undefined
  let disposed = false
  let syncQueued = false
  let cursorStateUpdateMode = "queued" as "queued" | "inline"
  let pendingScrollboxTop: number | undefined
  let scrollboxIntentQueued = false
  let viewportWidth = 0
  let viewportRows = 0
  let pendingChangeOrigin: PendingChangeOrigin | undefined

  const bufferMicrotask = (callback: () => void) => {
    queueMicrotask(() => {
      if (disposed) {
        return
      }
      callback()
    })
  }

  const textareaAdapter = createBufferTextareaAdapter({
    tabWidth,
    onLineInfoChange: () => {
      queueSync()
    },
    onTextareaCursorChanged: () => {
      updateCursorStateFromTextarea(cursorStateUpdateMode)
    },
    onTextareaSelectionChange: (event) => {
      handleTextareaSelectionChange(event)
    },
    onTextareaViewportChange: (event) => {
      handleTextareaViewportChange(event)
    },
    onBeforeVisualCursorMove: () => {
      viewportController.preservePreferredVisualColThroughMicrotask()
    },
  })
  const textGeometry = createTextGeometry({
    getDocument: doc,
    tabWidth,
    getWidthMethod: () => textareaAdapter.getWidthMethod(),
  })
  const viewportController = createBufferViewportController({
    textarea: textareaAdapter,
    geometry: textGeometry,
  })
  const editCommands = createBufferEditCommands({
    textarea: textareaAdapter,
    geometry: textGeometry,
    resetCursorTracking: viewportController.resetCursorTracking,
  })

  function updateCursorStateFromTextarea(mode: "queued" | "inline" = "queued") {
    if (scrollRef?.ctx.getSelection()?.isDragging) {
      // OpenTUI mutates cursor/viewport while selection autoscrolls; feeding that back here makes both sync loops race.
      return
    }

    const next = viewportController.captureCursorState()
    if (!next) {
      setCursorState(undefined)
      return
    }

    if (next.offset === undefined) {
      setCursorState(undefined)
      return
    }

    setCursorState({
      line: lineIndex(next.row),
      offset: next.offset,
    })
    if (mode === "inline") {
      syncActiveLineColor()
      return
    }

    queueSync()
  }

  const debouncedPush = debounce(() => {
    props.onTextChange(doc().text, { modified: doc().modified })
  }, DEBOUNCE_MS)

  const analysisHighlightLayer = props.analysis
    ? createAnalysisHighlightLayer({
        analysis: props.analysis,
        host: {
          getViewport: () => viewportController.readViewport(),
          getRenderTarget: () => textareaAdapter.createRenderTarget(),
          getDocument: doc,
          setSyntaxStyle: (style) => textareaAdapter.setSyntaxStyle(style),
          requestSync: () => queueSync(),
        },
      })
    : undefined

  const autocomplete = createBufferAutocomplete({
    provider: () => props.autocomplete,
    isFocused: props.isFocused,
    getText: () => doc().text,
    getCursorOffset: () => cursorState()?.offset,
    resolveAnchor: (replaceStart) => getAnchor(replaceStart),
    accept: (item, range) => replaceDocumentRange(range.start, range.end, item.insertText, item.cursorOffset),
  })

  const getTotalRowsForViewport = (nextViewportHeight: number) => {
    return Math.max(nextViewportHeight, viewportController.measureRows(nextViewportHeight, doc().version))
  }

  const setLayout = (height: number, rows: number) => {
    setLayoutState((current) => {
      if (current.viewportHeight === height && current.totalRows === rows) {
        return current
      }

      return { viewportHeight: height, totalRows: rows }
    })
  }

  const syncScrollMetrics = (nextViewportHeight: number) => {
    const height = Math.max(1, nextViewportHeight)
    const margin = getViewportInsetY({ height }) / height
    textareaAdapter.setScrollMargin(margin)
    setLayout(height, getTotalRowsForViewport(height))
  }

  const syncScrollboxTop = (top: number) => {
    if (!scrollRef) {
      return
    }
    // Scrollbox autoscroll can leave a transient visual offset; textarea owns the rendered rows here.
    scrollRef.content.translateY = 0
    if ((scrollRef.scrollTop ?? 0) === top) {
      return
    }

    scrollRef.scrollTo({ x: 0, y: top })
    scrollRef.content.translateY = 0
  }

  const syncScrollboxBarMetrics = () => {
    if (!scrollRef) {
      return
    }

    scrollRef.verticalScrollBar.scrollSize = scrollRef.scrollHeight
    scrollRef.verticalScrollBar.viewportSize = scrollRef.viewport.height
    scrollRef.horizontalScrollBar.scrollSize = scrollRef.scrollWidth
    scrollRef.horizontalScrollBar.viewportSize = scrollRef.viewport.width
  }

  const handleTextareaViewportChange = (event: SetViewportAfterEvent) => {
    syncScrollboxTop(event.y)
    analysisHighlightLayer?.sync()
  }

  const syncSelectionDragScrollSpeed = (selection: Selection) => {
    const metrics = textareaAdapter.readMetrics()
    if (!metrics) {
      return
    }

    const focus = selection.focus
    const maxY = metrics.y + Math.max(0, metrics.height - 1)
    const distance = Math.max(metrics.y - focus.y, focus.y - maxY, 0)
    const speed =
      distance >= SELECTION_DRAG_FAST_DISTANCE
        ? DEFAULT_SELECTION_DRAG_SCROLL_SPEED * 4
        : distance >= SELECTION_DRAG_MEDIUM_DISTANCE
          ? DEFAULT_SELECTION_DRAG_SCROLL_SPEED * 2
          : DEFAULT_SELECTION_DRAG_SCROLL_SPEED
    textareaAdapter.setScrollSpeed(speed)
  }

  const clampSelectionDragFocus = (selection: Selection) => {
    const metrics = textareaAdapter.readMetrics()
    if (!metrics) {
      return
    }

    const focus = selection.focus
    selection.focus = {
      x: Math.max(metrics.x, Math.min(focus.x, metrics.x + Math.max(0, metrics.width - 1))),
      y: Math.max(metrics.y, Math.min(focus.y, metrics.y + Math.max(0, metrics.height - 1))),
    }
  }

  const noteUserScroll = () => {
    viewportController.noteManualScroll()
  }

  const syncLineNumberViewportHeight = () => {
    if (!gutterRef || gutterRef.isDestroyed) {
      return
    }

    const height = layoutState().viewportHeight
    gutterRef.height = height
    gutterRef.minHeight = height
    gutterRef.maxHeight = height
  }

  const syncLineSigns = () => {
    if (!gutterRef || gutterRef.isDestroyed) {
      return
    }

    const signs = new Map<number, { before: string; beforeColor: string }>()
    for (const [line, marker] of props.gutterMarkers?.() ?? EMPTY_GUTTER_MARKERS) {
      if (!marker) {
        continue
      }
      signs.set(line, {
        before: marker,
        beforeColor: palette().get("text_muted"),
      })
    }
    gutterRef.setLineSigns(signs)
  }

  const syncActiveLineColor = () => {
    if (!gutterRef || gutterRef.isDestroyed) {
      return
    }

    const colors = new Map<number, { gutter: string; content: string }>()
    if (props.isFocused()) {
      colors.set(cursorState()?.line ?? lineIndex(0), {
        gutter: palette().get("editor_active_line_background"),
        content: palette().get("editor_active_line_background"),
      })
    }
    gutterRef.setLineColors(colors)
  }

  const setEditorViewport = (
    top: number,
    nextHeight = textareaAdapter.readMetrics()?.height ?? 1,
    moveCursor = false,
  ) => {
    const metrics = textareaAdapter.readMetrics()
    const editorViewport = textareaAdapter.readViewport()
    if (!metrics || !editorViewport) {
      return
    }

    const height = Math.max(1, nextHeight)
    const margin = getViewportInsetY({ height }) / height
    textareaAdapter.setScrollMargin(margin)
    const nextTop = Math.max(0, Math.min(top, Math.max(0, getTotalRowsForViewport(height) - height)))
    if (
      editorViewport.offsetY === nextTop &&
      editorViewport.width === metrics.width &&
      editorViewport.height === height
    ) {
      pendingScrollboxTop = undefined
      syncScrollMetrics(height)
      syncScrollboxTop(metrics.scrollY)
      return
    }

    pendingScrollboxTop = moveCursor ? nextTop : undefined
    cursorStateUpdateMode = moveCursor ? "inline" : "queued"
    const change = viewportController.setViewport(
      editorViewport.offsetX,
      nextTop,
      Math.max(1, metrics.width),
      height,
      moveCursor,
    )
    if (moveCursor || change.cursorChanged) {
      updateCursorStateFromTextarea(cursorStateUpdateMode)
    }
    cursorStateUpdateMode = "queued"
    textareaAdapter.requestRender()
    const nextMetrics = textareaAdapter.readMetrics()
    if (!moveCursor && scrollRef && nextMetrics && (scrollRef.scrollTop ?? 0) !== nextMetrics.scrollY) {
      scrollRef.scrollTo({ x: 0, y: nextMetrics.scrollY })
    }
  }

  const syncScrollboxFromEditor = () => {
    const metrics = textareaAdapter.readMetrics()
    if (!scrollRef || !metrics) {
      return
    }

    syncScrollboxBarMetrics()
    const viewport = getViewportRect(scrollRef)
    const height = Math.max(1, viewport.height)
    const maxTop = Math.max(0, getTotalRowsForViewport(height) - height)
    if (pendingScrollboxTop !== undefined && metrics.scrollY === pendingScrollboxTop) {
      pendingScrollboxTop = undefined
    }
    if (metrics.scrollY > maxTop) {
      setEditorViewport(maxTop, height)
      return
    }

    syncScrollMetrics(height)
    syncScrollboxTop(metrics.scrollY)
  }

  const applyScrollboxIntent = () => {
    scrollboxIntentQueued = false
    if (!scrollRef) {
      return
    }

    syncScrollboxBarMetrics()
    const viewport = getViewportRect(scrollRef)
    const height = Math.max(1, viewport.height)
    setLayout(height, getTotalRowsForViewport(height))
    const nextTop = scrollRef.scrollTop ?? 0
    let moveCursor = true
    const editorViewport = textareaAdapter.readViewport()
    const cursor = textareaAdapter.readCursor()
    if (editorViewport && cursor) {
      const currentRow = editorViewport.offsetY + cursor.visualRow
      const band = getViewportBandY({ height: viewport.height })
      moveCursor = currentRow < nextTop + band.start || currentRow > nextTop + band.end
    }
    setEditorViewport(nextTop, viewport.height, moveCursor)
    analysisHighlightLayer?.sync({ scheduleUpdate: false })
    scrollRef.content.translateY = 0
  }

  const queueScrollboxIntent = () => {
    if (scrollboxIntentQueued) {
      return
    }

    scrollboxIntentQueued = true
    bufferMicrotask(applyScrollboxIntent)
  }

  const handleScrollboxSync = () => {
    if (!scrollRef) {
      return
    }

    // Scrollbox can also receive drag events; textarea owns selection autoscroll here.
    scrollRef.stopAutoScroll()
    scrollRef.content.translateY = 0
    syncScrollboxBarMetrics()
    if (scrollboxIntentQueued) {
      return
    }

    const viewport = getViewportRect(scrollRef)
    if (viewport.width !== viewportWidth || viewport.height !== viewportRows) {
      viewportWidth = viewport.width
      viewportRows = viewport.height
      queueSync()
      return
    }

    const metrics = textareaAdapter.readMetrics()
    if (!metrics) {
      return
    }

    if (pendingScrollboxTop !== undefined) {
      if (metrics.scrollY === pendingScrollboxTop) {
        pendingScrollboxTop = undefined
        queueSync()
      }
      if ((scrollRef.scrollTop ?? 0) === pendingScrollboxTop) {
        return
      }
      pendingScrollboxTop = undefined
    }

    if ((scrollRef.scrollTop ?? 0) !== metrics.scrollY) {
      syncScrollboxTop(metrics.scrollY)
    }
  }

  const syncLayout = () => {
    syncQueued = false
    syncScrollboxFromEditor()
    syncActiveLineColor()
    syncLineNumberViewportHeight()
    analysisHighlightLayer?.sync()
    autocomplete.syncAnchor()
  }

  function queueSync() {
    if (syncQueued) {
      return
    }

    syncQueued = true
    bufferMicrotask(syncLayout)
  }

  function getAnchor(replaceStart: DocCharOffset): SelectPopupAnchor | null {
    const metrics = textareaAdapter.readMetrics()
    if (!bufferRootRef || !metrics) {
      return null
    }

    const point = viewportController.resolveViewportPoint(replaceStart)
    if (!point) {
      return null
    }

    return {
      x: Math.max(0, metrics.x + point.x - bufferRootRef.x - 1),
      y: Math.max(0, metrics.y + point.y - bufferRootRef.y),
      containerWidth: bufferRootRef.width,
      containerHeight: bufferRootRef.height,
    }
  }

  const replaceDocumentRange = (
    start: DocCharOffset,
    end: DocCharOffset,
    insertText: string,
    nextCursorOffset?: number,
    origin: PendingChangeOrigin["origin"] = "autocomplete",
  ) => {
    pendingChangeOrigin = {
      origin,
      remainingEvents: start === end ? 1 : 2,
    }
    const replaced = editCommands.replaceDocRange(start, end, insertText, nextCursorOffset)
    if (!replaced) {
      return false
    }
    bufferMicrotask(() => {
      updateCursorStateFromTextarea()
    })
    return true
  }

  const deleteToLineStart = () => {
    const currentOffset = cursorState()?.offset
    if (currentOffset === undefined) {
      return false
    }

    const edit = getDeleteToLineStartEdit(doc(), currentOffset)
    if (!edit) {
      return true
    }

    return replaceDocumentRange(edit.start, edit.end, edit.insertText, edit.cursorOffsetFromStart, "user")
  }

  const flush = () => {
    debouncedPush.clear()
    props.onTextChange(doc().text, { modified: doc().modified })
  }

  const applyTextChange = (nextText: string, modified: boolean, change?: BufferTextChange) => {
    const edit = doc().applyText(nextText, modified)
    const next = edit.document
    if (next === doc()) {
      return
    }

    analysisHighlightLayer?.rebuild(next, change ?? edit.change)
    setDoc(next)
    viewportController.resetMeasuredRows()
    debouncedPush()
  }

  const focus = () => {
    textareaAdapter.focus()
  }

  const setText = (nextText: string) => {
    const normalizedText = normalizeDocumentText(nextText)
    const hasTextarea = textareaAdapter.readText() !== undefined
    if (normalizedText !== doc().text) {
      analysisHighlightLayer?.reset()
    }
    applyTextChange(normalizedText, false)
    if (hasTextarea) {
      textareaAdapter.setText(normalizedText)
      editCommands.setCursorDocOffset(docCharOffset(0))
    }
    setCursorState({ line: lineIndex(0), offset: docCharOffset(0) })
    queueSync()
  }

  const handleContentChange = () => {
    const textValue = textareaAdapter.readText()
    if (textValue === undefined) {
      return
    }

    const nextText = normalizeDocumentText(textValue)
    const change = findTextChange(doc().text, nextText)
    const pending = pendingChangeOrigin
    const origin = pending?.origin ?? "user"
    if (pending && pending.remainingEvents > 1) {
      pendingChangeOrigin = {
        origin: pending.origin,
        remainingEvents: pending.remainingEvents - 1,
      }
    }
    if (!pending || pending.remainingEvents <= 1) {
      pendingChangeOrigin = undefined
    }

    const modified = change ? true : doc().modified
    if (!change && nextText === doc().text && modified === doc().modified) {
      updateCursorStateFromTextarea("queued")
      queueSync()
      if (origin === "user") {
        bufferMicrotask(() => {
          autocomplete.refresh()
        })
      }
      return
    }
    applyTextChange(nextText, modified, change)
    updateCursorStateFromTextarea("queued")
    queueSync()
    if (origin === "user") {
      bufferMicrotask(() => {
        autocomplete.refresh()
      })
    }
  }

  const setScrollRef = (node: ScrollBoxRenderable | undefined) => {
    scrollRef = node
    const viewport = node ? getViewportRect(node) : null
    viewportWidth = viewport?.width ?? 0
    viewportRows = viewport?.height ?? 0
    queueSync()
    if (node) {
      setTimeout(() => {
        if (disposed || scrollRef !== node) {
          return
        }
        queueSync()
      }, 0)
    }
  }

  const setGutterRef = (node: LineNumberRenderable | undefined) => {
    gutterRef = node
    queueSync()
  }

  const setTextareaRef = (node: TextareaRenderable | undefined) => {
    textareaAdapter.attach(node)
    if (!node) {
      return
    }
    textareaAdapter.setSyntaxStyle(props.analysis?.syntaxStyle() ?? null)
    queueSync()
    setTimeout(() => {
      if (disposed || !textareaAdapter.isAttached(node)) {
        return
      }
      node.flexShrink = 1
      queueSync()
    }, 0)
    if (props.isFocused()) {
      bufferMicrotask(() => {
        textareaAdapter.focus()
      })
    }
  }

  const handleScrollboxUserScroll = () => {
    noteUserScroll()
    autocomplete.close()
    queueScrollboxIntent()
  }

  const handleTextareaMouseDown = (event: MouseEvent) => {
    event.stopPropagation()
    props.focusSelf()
  }

  const handleTextareaMouseScroll = () => {
    noteUserScroll()
    props.focusSelf()
  }

  const finishSelectionDrag = () => {
    const metrics = textareaAdapter.readMetrics()
    if (metrics) {
      syncScrollboxTop(metrics.scrollY)
    }
    textareaAdapter.setCursorVisible(true)
    textareaAdapter.setLive(false)
    textareaAdapter.setScrollSpeed(DEFAULT_SELECTION_DRAG_SCROLL_SPEED)
    updateCursorStateFromTextarea("queued")
  }

  const handleTextareaSelectionChange = (event: SelectionChangeEvent) => {
    const before = event.result === undefined
    const selection = event.selection
    if (before && selection?.isDragging) {
      syncSelectionDragScrollSpeed(selection)
      clampSelectionDragFocus(selection)
    }

    const dragging = Boolean(selection?.isDragging)
    if (before) {
      if (!dragging) {
        return
      }

      // OpenTUI applies selection autoscroll from onUpdate, so it must stay live while the mouse is held.
      textareaAdapter.setLive(true)
      textareaAdapter.setCursorVisible(false)
      autocomplete.close()
      return
    }

    if (!dragging) {
      finishSelectionDrag()
      return
    }
  }

  const handleCursorChange = () => {
    updateCursorStateFromTextarea(cursorStateUpdateMode)
  }

  const handleEscape = () => {
    flush()
    props.onUnfocus?.()
  }

  onMount(() => {
    props.registerApi?.({
      setText,
      focus,
      getCursorOffset: () => cursorState()?.offset,
    })
  })

  onCleanup(() => {
    disposed = true
    syncQueued = false
    scrollboxIntentQueued = false
    debouncedPush.clear()
    autocomplete.close()
    analysisHighlightLayer?.dispose()
    textareaAdapter.setLive(false)
    textareaAdapter.setScrollSpeed(DEFAULT_SELECTION_DRAG_SCROLL_SPEED)
    textareaAdapter.detach()
  })

  createEffect(() => {
    const state = {
      document: doc(),
      cursor: cursorState(),
    } satisfies BufferState
    props.onStateChange?.(state)
  })

  createEffect(() => {
    props.analysis?.syntaxStyle()
    queueSync()
  })

  createEffect(() => {
    props.gutterMarkers?.()
    palette().get("text_muted")
    syncLineSigns()
  })

  createEffect(() => {
    props.isFocused()
    cursorState()?.line
    syncActiveLineColor()
  })

  createEffect(
    on(
      props.isFocused,
      (isFocused) => {
        if (!isFocused) {
          textareaAdapter.blur()
          autocomplete.close()
          return
        }
        bufferMicrotask(() => {
          textareaAdapter.focus()
          queueSync()
        })
      },
      { defer: true },
    ),
  )

  analysisHighlightLayer?.rebuild(doc())

  return {
    document: {
      doc,
    },
    layout: {
      viewportHeight: () => layoutState().viewportHeight,
      totalRows: () => layoutState().totalRows,
    },
    autocomplete: {
      viewModel: autocomplete.viewModel,
    },
    refs: {
      setRoot: (node: BoxRenderable | undefined) => {
        bufferRootRef = node
      },
      setScrollbox: setScrollRef,
      setGutter: setGutterRef,
      setTextarea: setTextareaRef,
    },
    scrollbox: {
      handleSync: handleScrollboxSync,
      handleUserScroll: handleScrollboxUserScroll,
    },
    root: {
      handleMouseDragEnd: finishSelectionDrag,
      handleMouseUp: finishSelectionDrag,
    },
    textarea: {
      handleMouseDown: handleTextareaMouseDown,
      handleMouseScroll: handleTextareaMouseScroll,
      handleCursorChange,
      handleContentChange,
    },
    commands: {
      escape: handleEscape,
      deleteToLineStart,
    },
  }
}
