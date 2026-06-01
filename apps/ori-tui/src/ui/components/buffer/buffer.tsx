import type { BoxRenderable, LineNumberRenderable, MouseEvent, TextareaRenderable } from "@opentui/core"
import { OriScrollbox } from "@ui/components/ori-scrollbox"
import { SelectPopup } from "@ui/components/select-popup"
import { useTheme } from "@ui/providers/theme"
import { type KeyBinding, KeyScope } from "@ui/services/key-scopes"
import { debounce } from "@utils/debounce"
import { type Accessor, createEffect, createSignal, on, onCleanup, onMount } from "solid-js"
import { type BufferAnalysis, createAnalysisHighlightLayer } from "./analysis"
import { createBufferAutocomplete } from "./autocomplete/controller"
import type { BufferAutocompleteProvider } from "./autocomplete/types"
import { createBufferEditCommands, getDeleteToLineStartEdit } from "./buffer-edit-commands"
import { createBufferGutterAdapter } from "./buffer-gutter-adapter"
import { createBufferTextareaAdapter } from "./buffer-textarea-adapter"
import { type DocCharOffset, docCharOffset, type LineIndex, lineIndex } from "./coords"
import { type BufferTextChange, Document, findTextChange, normalizeDocumentText } from "./document"
import type { SelectionChangeEvent } from "./opentui-textarea-extensions/selection-hooks"
import { createTextGeometry } from "./text-geometry"
import { createViewport } from "./viewport"

const DEBOUNCE_MS = 200
const DEFAULT_TAB_WIDTH = 2
const DEFAULT_SELECTION_DRAG_SCROLL_SPEED = 16

type PendingChangeOrigin = {
  origin: "user" | "autocomplete"
  remainingEvents: number
}

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

type CursorStateSyncOptions = {
  keepStickyVisualColumn?: boolean
}

export function Buffer(props: BufferProps) {
  const { theme } = useTheme()
  const tabWidth = Math.max(1, props.tabWidth ?? DEFAULT_TAB_WIDTH)
  const [doc, setDoc] = createSignal(Document.create(props.initialText))

  const [cursorState, setCursorState] = createSignal<BufferCursor>({
    line: lineIndex(0),
    offset: docCharOffset(0),
  })

  let bufferRootRef: BoxRenderable | undefined
  let disposed = false
  let renderQueued = false
  let cursorStateUpdateMode = "queued" as "queued" | "inline"
  let pendingChangeOrigin: PendingChangeOrigin | undefined
  let analysisHighlightLayer: ReturnType<typeof createAnalysisHighlightLayer> | undefined

  const background = () => theme().get("editor_background")

  const defer = (callback: () => void) => {
    queueMicrotask(() => {
      if (disposed) {
        return
      }
      callback()
    })
  }

  const queueRender = () => {
    if (renderQueued) {
      return
    }

    renderQueued = true
    defer(() => {
      renderQueued = false
      viewport.renderScrollboxFromTextarea()
      gutterAdapter.renderCursorLine()
      gutterAdapter.renderViewportRows(viewport.viewportRows())
      analysisHighlightLayer?.renderVisibleStatements()
      autocomplete.repositionPopup()
    })
  }

  const textareaAdapter = createBufferTextareaAdapter({
    tabWidth,
    onVisualLayoutChange: () => {
      queueRender()
    },
    onTextareaCursorChanged: (options) => {
      updateCursorStateFromTextarea(cursorStateUpdateMode, options)
    },
    onTextareaSelectionChange: (event) => {
      handleTextareaSelectionChange(event)
    },
    onTextareaViewportChange: (event) => {
      viewport.handleTextareaViewportChange(event)
    },
    onVisualCursorMoveStart: () => {
      viewport.startVisualCursorMove()
    },
    onVisualCursorMoveEnd: () => {
      viewport.endVisualCursorMove()
    },
  })
  const textGeometry = createTextGeometry({
    getDocument: doc,
    tabWidth,
    getWidthMethod: () => textareaAdapter.getWidthMethod(),
  })
  const viewport = createViewport({
    textarea: textareaAdapter,
    geometry: textGeometry,
    queueRender,
    defer,
    isDisposed: () => disposed,
    setCursorStateUpdateMode: (mode) => {
      cursorStateUpdateMode = mode
    },
    updateCursorFromTextarea: (mode, options) => {
      updateCursorStateFromTextarea(mode, options)
    },
    renderVisibleAnalysis: (options) => {
      analysisHighlightLayer?.renderVisibleStatements(options)
    },
  })
  const editCommands = createBufferEditCommands({
    textarea: textareaAdapter,
    geometry: textGeometry,
    resetCursorTracking: viewport.resetCursorTracking,
  })

  function updateCursorStateFromTextarea(mode: "queued" | "inline" = "queued", options?: CursorStateSyncOptions) {
    if (viewport.isSelecting()) {
      // OpenTUI mutates cursor/viewport while selection autoscrolls; feeding that back here makes both render loops race.
      return
    }

    const next = viewport.captureCursorState(options)
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
      gutterAdapter.renderCursorLine()
      return
    }

    queueRender()
  }

  function isCursorStateSyncedWithTextarea() {
    const current = cursorState()
    const cursor = textareaAdapter.readCursor()
    if (!current || !cursor) {
      return false
    }

    const offset = doc().offsetAtLineChar(cursor.logicalRow, cursor.logicalCol)
    return current.line === lineIndex(cursor.logicalRow) && current.offset === offset
  }

  const debouncedPush = debounce(() => {
    props.onTextChange(doc().text, { modified: doc().modified })
  }, DEBOUNCE_MS)

  analysisHighlightLayer = props.analysis
    ? createAnalysisHighlightLayer({
        analysis: props.analysis,
        host: {
          getViewport: () => viewport.snapshot(),
          getRenderTarget: () => textareaAdapter.createRenderTarget(),
          getDocument: doc,
          setSyntaxStyle: (style) => textareaAdapter.setSyntaxStyle(style),
          queueViewportRender: queueRender,
        },
      })
    : undefined

  const autocomplete = createBufferAutocomplete({
    provider: () => props.autocomplete,
    isFocused: props.isFocused,
    getText: () => doc().text,
    getCursorOffset: () => cursorState()?.offset,
    resolveAnchor: (replaceStart) => {
      const box = textareaAdapter.readBox()
      if (!bufferRootRef || !box) {
        return null
      }

      const point = viewport.resolveViewportPoint(replaceStart)
      if (!point) {
        return null
      }

      return {
        x: Math.max(0, box.x + point.x - bufferRootRef.x - 1),
        y: Math.max(0, box.y + point.y - bufferRootRef.y),
        containerWidth: bufferRootRef.width,
        containerHeight: bufferRootRef.height,
      }
    },
    accept: (item, range) => replaceDocumentRange(range.start, range.end, item.insertText, item.cursorOffset),
  })

  const gutterAdapter = createBufferGutterAdapter({
    palette: theme,
    isFocused: props.isFocused,
    getCursorLine: () => cursorState()?.line,
    getMarkers: () => props.gutterMarkers?.(),
    queueRender,
  })

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
    defer(() => {
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
    textareaAdapter.resetMeasurements()
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
    queueRender()
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
      queueRender()
      if (origin === "user") {
        defer(() => {
          autocomplete.refresh()
        })
      }
      return
    }
    applyTextChange(nextText, modified, change)
    updateCursorStateFromTextarea("queued")
    queueRender()
    if (origin === "user") {
      defer(() => {
        autocomplete.refresh()
      })
    }
  }

  const attachTextarea = (node: TextareaRenderable | undefined) => {
    textareaAdapter.attach(node)
    if (!node) {
      return
    }
    textareaAdapter.setSyntaxStyle(props.analysis?.syntaxStyle() ?? null)
    queueRender()
    setTimeout(() => {
      if (disposed || !textareaAdapter.isAttached(node)) {
        return
      }
      node.flexShrink = 1
      queueRender()
    }, 0)
    if (props.isFocused()) {
      defer(() => {
        textareaAdapter.focus()
      })
    }
  }

  const handleScrollboxUserScroll = () => {
    viewport.rememberScrollStickyColumn()
    autocomplete.close()
    viewport.requestUserScroll()
  }

  const handleTextareaMouseDown = (event: MouseEvent) => {
    event.stopPropagation()
    props.focusSelf()
  }

  const handleTextareaMouseScroll = () => {
    viewport.rememberScrollStickyColumn()
    props.focusSelf()
  }

  const finishSelectionDrag = () => {
    const box = textareaAdapter.readBox()
    if (box) {
      viewport.moveScrollboxToTextareaTop(box.top)
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
      viewport.adjustSelectionDragSpeed(selection)
      viewport.clampSelectionDragFocus(selection)
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
    if (isCursorStateSyncedWithTextarea()) {
      return
    }

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
    renderQueued = false
    viewport.dispose()
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
    queueRender()
  })

  createEffect(() => {
    props.gutterMarkers?.()
    theme().get("text_muted")
    gutterAdapter.renderMarkers()
  })

  createEffect(() => {
    props.isFocused()
    cursorState()?.line
    gutterAdapter.renderCursorLine()
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
        defer(() => {
          textareaAdapter.focus()
          queueRender()
        })
      },
      { defer: true },
    ),
  )

  analysisHighlightLayer?.rebuild(doc())

  const bindings: KeyBinding[] = [
    {
      pattern: "escape",
      handler: handleEscape,
      preventDefault: true,
    },
    {
      pattern: "ctrl+u",
      handler: () => {
        deleteToLineStart()
      },
      preventDefault: true,
    },
  ]

  return (
    <KeyScope
      bindings={bindings}
      enabled={props.isFocused}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: root terminates drag selection when release lands outside textarea */}
      <box
        ref={(node: BoxRenderable | undefined) => {
          bufferRootRef = node
        }}
        position="relative"
        flexDirection="column"
        flexGrow={1}
        backgroundColor={background()}
        onMouseUp={finishSelectionDrag}
        onMouseDragEnd={finishSelectionDrag}
      >
        <OriScrollbox
          marginTop={1}
          stickyScroll={false}
          scrollX={false}
          onReady={viewport.attachScrollbox}
          onSync={viewport.handleScrollboxStateChange}
          onUserScroll={handleScrollboxUserScroll}
          height="100%"
          horizontalScrollbarOptions={{
            trackOptions: {
              backgroundColor: background(),
            },
          }}
          verticalScrollbarOptions={{
            trackOptions: {
              backgroundColor: background(),
            },
          }}
          minVerticalThumbHeight={2}
        >
          <box
            position="relative"
            flexDirection="column"
            backgroundColor={background()}
            width="100%"
          >
            <box
              height={viewport.contentRows()}
              minHeight={viewport.contentRows()}
              maxHeight={viewport.contentRows()}
            />
            <line_number
              ref={(node: LineNumberRenderable | undefined) => {
                gutterAdapter.attach(node)
              }}
              position="absolute"
              top={0}
              left={0}
              width="100%"
              height={viewport.viewportRows()}
              minHeight={viewport.viewportRows()}
              maxHeight={viewport.viewportRows()}
              fg={theme().get("text_muted")}
              bg={background()}
              paddingRight={1}
              minWidth={5}
            >
              <textarea
                ref={(node: TextareaRenderable | undefined) => {
                  attachTextarea(node)
                }}
                height={viewport.viewportRows()}
                minHeight={viewport.viewportRows()}
                maxHeight={viewport.viewportRows()}
                width="100%"
                flexGrow={1}
                flexShrink={1}
                initialValue={doc().text}
                textColor={theme().get("editor_text")}
                focusedTextColor={theme().get("editor_text")}
                backgroundColor="transparent"
                focusedBackgroundColor="transparent"
                cursorColor={theme().get("editor_cursor")}
                wrapMode="char"
                selectable={true}
                keyBindings={[]}
                onMouseDown={handleTextareaMouseDown}
                onMouseScroll={handleTextareaMouseScroll}
                onCursorChange={handleCursorChange}
                onContentChange={handleContentChange}
              />
            </line_number>
          </box>
        </OriScrollbox>
        <SelectPopup viewModel={autocomplete.viewModel} />
      </box>
    </KeyScope>
  )
}
