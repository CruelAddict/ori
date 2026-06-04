import type { BoxRenderable, LineNumberRenderable, MouseEvent, TextareaRenderable } from "@opentui/core"
import { OriScrollbox } from "@ui/components/ori-scrollbox"
import { SelectPopup } from "@ui/components/select-popup"
import { useTheme } from "@ui/providers/theme"
import { type KeyBinding, KeyScope } from "@ui/services/key-scopes"
import { type Accessor, createEffect, createSignal, on, onCleanup, onMount } from "solid-js"
import { type BufferAnalysis, createAnalysisHighlightLayer } from "./analysis"
import { createBufferAutocomplete } from "./autocomplete/controller"
import type { BufferAutocompleteProvider } from "./autocomplete/types"
import { type BufferAppliedEdit, createBufferEditCommands } from "./buffer-edit-commands"
import { type BufferTextareaCursorChangeEvent, createBufferTextareaAdapter } from "./buffer-textarea-adapter"
import { type DocCharOffset, docCharOffset, type LineIndex, lineIndex } from "./coords"
import { type BufferTextChange, Document, findTextChange, normalizeDocumentText } from "./document"
import { createTextGeometry } from "./text-geometry"
import { createViewport } from "./viewport"

const DEFAULT_TAB_WIDTH = 2
const EMPTY_GUTTER_MARKERS = new Map<number, string>()

type DecorationsRenderOptions = {
  eventSource?: "scrollbox"
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
  cause?: BufferTextareaCursorChangeEvent["cause"]
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
  let gutterRef: LineNumberRenderable | undefined
  let disposed = false
  let renderQueued = false
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

  const queueDecorationsRender = () => {
    if (renderQueued) {
      return
    }

    renderQueued = true
    defer(() => {
      if (!renderQueued) {
        return
      }
      renderQueued = false
      renderDecorations()
    })
  }

  function renderDecorations(options: DecorationsRenderOptions = {}) {
    const fromScrollbox = options.eventSource === "scrollbox"
    if (!fromScrollbox) {
      viewport.renderScrollboxFromTextarea()
    }
    renderGutter()
    analysisHighlightLayer?.renderVisibleStatements({ continueHighlighting: !fromScrollbox })
    autocomplete.repositionPopup()
  }

  function renderGutter(options: { layout?: boolean; markers?: boolean; cursor?: boolean } = {}) {
    const node = gutterRef
    if (!node || node.isDestroyed) {
      return
    }

    const renderLayout = options.layout ?? true
    const renderMarkers = options.markers ?? true
    const renderCursor = options.cursor ?? true

    if (renderLayout) {
      const rows = viewport.viewportRows()
      node.height = rows
      node.minHeight = rows
      node.maxHeight = rows
    }

    if (renderMarkers) {
      const signs = new Map<number, { before: string; beforeColor: string }>()
      for (const [line, marker] of props.gutterMarkers?.() ?? EMPTY_GUTTER_MARKERS) {
        if (!marker) {
          continue
        }
        signs.set(line, {
          before: marker,
          beforeColor: theme().get("text_muted"),
        })
      }
      node.setLineSigns(signs)
    }

    if (!renderCursor) {
      return
    }

    const colors = new Map<number, { gutter: string; content: string }>()
    if (props.isFocused()) {
      const color = theme().get("editor_active_line_background")
      colors.set(cursorState()?.line ?? lineIndex(0), {
        gutter: color,
        content: color,
      })
    }
    node.setLineColors(colors)
  }

  const textareaAdapter = createBufferTextareaAdapter({
    tabWidth,
    onVisualLayoutChange: () => {
      queueDecorationsRender()
    },
    onTextareaCursorChanged: (options) => {
      updateCursorStateFromTextarea(options)
    },
    onTextareaSelectionChange: (event) => {
      if (event.result === undefined && event.selection?.isDragging) {
        autocomplete.close()
      }
      viewport.handleTextareaSelectionChange(event)
    },
    onTextareaViewportChange: (event) => {
      viewport.handleTextareaViewportChange(event)
      renderDecorations({ eventSource: "scrollbox" })
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
    updateCursorFromTextarea: (options) => {
      updateCursorStateFromTextarea(options)
    },
  })
  const editCommands = createBufferEditCommands({
    textarea: textareaAdapter,
    geometry: textGeometry,
    resetCursorTracking: viewport.resetCursorTracking,
  })

  function updateCursorStateFromTextarea(options?: CursorStateSyncOptions) {
    if (viewport.isSelecting()) {
      // OpenTUI mutates cursor/viewport while selection autoscrolls; feeding that back here makes both render loops race.
      return
    }

    const previousOffset = cursorState()?.offset
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
    queueDecorationsRender()
    if (options?.cause === "input" && previousOffset !== next.offset) {
      autocomplete.refresh()
    }
  }

  analysisHighlightLayer = props.analysis
    ? createAnalysisHighlightLayer({
        analysis: props.analysis,
        host: {
          getViewport: () => viewport.snapshot(),
          getRenderTarget: () => textareaAdapter.createRenderTarget(),
          getDocument: doc,
          setSyntaxStyle: (style) => textareaAdapter.setSyntaxStyle(style),
          queueViewportRender: queueDecorationsRender,
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
    accept: (item, range) =>
      applyProgrammaticEdit(editCommands.replaceDocRange(range.start, range.end, item.insertText, item.cursorOffset)),
  })

  const applyProgrammaticEdit = (edit: BufferAppliedEdit | undefined) => {
    if (!edit) {
      return false
    }

    applyTextChange(edit.text, true)
    textareaAdapter.setText(edit.text, "buffer")
    editCommands.setCursorDocOffset(edit.cursorOffset)
    defer(() => {
      updateCursorStateFromTextarea()
    })
    return true
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
    props.onTextChange(next.text, { modified: next.modified })
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
      textareaAdapter.setText(normalizedText, "buffer")
      editCommands.setCursorDocOffset(docCharOffset(0))
    }
    setCursorState({ line: lineIndex(0), offset: docCharOffset(0) })
    queueDecorationsRender()
  }

  const handleContentChange = () => {
    const textValue = textareaAdapter.readText()
    if (textValue === undefined) {
      return
    }

    const nextText = normalizeDocumentText(textValue)
    const change = findTextChange(doc().text, nextText)
    const modified = change ? true : doc().modified
    if (!change && nextText === doc().text && modified === doc().modified) {
      updateCursorStateFromTextarea()
      return
    }
    applyTextChange(nextText, modified, change)
    updateCursorStateFromTextarea()
    defer(() => {
      autocomplete.refresh()
    })
  }

  const attachTextarea = (node: TextareaRenderable | undefined) => {
    textareaAdapter.attach(node)
    if (!node) {
      return
    }
    textareaAdapter.setSyntaxStyle(props.analysis?.syntaxStyle() ?? null)
    queueDecorationsRender()
    setTimeout(() => {
      if (disposed || !textareaAdapter.isAttached(node)) {
        return
      }
      node.flexShrink = 1
      queueDecorationsRender()
    }, 0)
    if (props.isFocused()) {
      defer(() => {
        textareaAdapter.focus()
      })
    }
  }

  const handleScrollboxUserScroll = () => {
    autocomplete.close()
    if (!viewport.requestUserScroll()) {
      return
    }

    defer(() => {
      if (viewport.applyPendingUserScroll()) {
        renderQueued = false
        renderDecorations({ eventSource: "scrollbox" })
      }
    })
  }

  const attachScrollbox = (node: Parameters<typeof viewport.attachScrollbox>[0]) => {
    viewport.attachScrollbox(node)
    queueDecorationsRender()
    if (!node) {
      return
    }

    setTimeout(() => {
      if (disposed || !viewport.isScrollboxAttached(node)) {
        return
      }
      queueDecorationsRender()
    }, 0)
  }

  const handleScrollboxStateChange = () => {
    if (viewport.handleScrollboxStateChange()) {
      queueDecorationsRender()
    }
  }

  const handleTextareaMouseDown = (event: MouseEvent) => {
    event.stopPropagation()
    props.focusSelf()
  }

  const handleEscape = () => {
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
    autocomplete.close()
    analysisHighlightLayer?.dispose()
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
    props.gutterMarkers?.()
    theme().get("text_muted")
    props.isFocused()
    cursorState()?.line
    theme().get("editor_active_line_background")
    queueDecorationsRender()
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
          queueDecorationsRender()
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
        autocomplete.close()
        applyProgrammaticEdit(editCommands.deleteToLineStart())
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
        onMouseUp={viewport.finishSelectionDrag}
        onMouseDragEnd={viewport.finishSelectionDrag}
      >
        <OriScrollbox
          marginTop={1}
          stickyScroll={false}
          scrollX={false}
          onReady={attachScrollbox}
          onSync={handleScrollboxStateChange}
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
                gutterRef = node
                queueDecorationsRender()
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
                onMouseScroll={viewport.handleTextareaMouseScroll}
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
