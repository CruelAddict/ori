import type { BoxRenderable, KeyEvent, MouseEvent, TextareaRenderable } from "@opentui/core"
import { OriScrollbox } from "@ui/components/ori-scrollbox"
import { SelectPopup } from "@ui/components/select-popup"
import { useTheme } from "@ui/providers/theme"
import { type KeyBinding, KeyScope } from "@ui/services/key-scopes"
import { createDeferredCallback } from "@utils/deferred-callback"
import { type Accessor, createEffect, createSignal, on, onCleanup, onMount } from "solid-js"
import { createBufferAutocomplete } from "./autocomplete/controller"
import type { BufferAutocompleteProvider } from "./autocomplete/types"
import "./buffer-line-number-renderable"
import {
  type BufferTextareaCursorChangeCause,
  type BufferTextareaCursorChangeEvent,
  createBufferTextareaAdapter,
} from "./buffer-textarea-adapter"
import { type DocCharOffset, docCharOffset, type LineIndex, lineIndex } from "./coords"
import { type BufferTextChange, Document, findTextChange, normalizeDocumentText } from "./document"
import { attachBufferExtensions, type BufferExtension } from "./extension"
import { createGutter } from "./gutter"
import { createTextGeometry } from "./text-geometry"
import { createViewport } from "./viewport"

const DEFAULT_TAB_WIDTH = 2

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
  onStateChange?: (state: BufferState) => void
  autocomplete?: BufferAutocompleteProvider
  extensions?: readonly BufferExtension[]
}

type CursorStateSyncOptions = {
  cause?: BufferTextareaCursorChangeEvent["cause"]
  keepStickyVisualColumn?: boolean
}

function shouldTriggerAutocompleteOnKeyDown(event: KeyEvent) {
  if (event.defaultPrevented || event.ctrl || event.meta || event.super || event.hyper) {
    return false
  }

  if (event.name === "space") {
    return true
  }

  if (!event.sequence) {
    return false
  }

  const firstCharCode = event.sequence.charCodeAt(0)
  if (firstCharCode < 32 || firstCharCode === 127) {
    return false
  }

  return true
}

export function Buffer(props: BufferProps) {
  const { theme } = useTheme()
  const tabWidth = Math.max(1, props.tabWidth ?? DEFAULT_TAB_WIDTH)
  const tabText = " ".repeat(tabWidth)
  const [doc, setDoc] = createSignal(Document.create(props.initialText))

  const [cursorState, setCursorState] = createSignal<BufferCursor>({
    line: lineIndex(0),
    offset: docCharOffset(0),
  })

  let bufferRootRef: BoxRenderable | undefined
  let disposed = false
  let extensions: ReturnType<typeof attachBufferExtensions>

  const background = () => theme().get("editor_background")

  const defer = (callback: () => void) => {
    queueMicrotask(() => {
      if (disposed) {
        return
      }
      callback()
    })
  }

  const queueDecorationsRender = createDeferredCallback(() => {
    if (disposed) {
      return
    }

    renderDecorations()
  })

  function renderDecorations(options: DecorationsRenderOptions = {}) {
    const fromScrollbox = options.eventSource === "scrollbox"
    if (!fromScrollbox) {
      viewport.renderScrollboxFromTextarea()
    }
    extensions.emitDecorationsRender()
    gutter.render()
    autocomplete.repositionPopup()
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
  const gutter = createGutter({
    theme,
    rows: () => viewport.viewportRows(),
    isFocused: props.isFocused,
    cursorLine: () => cursorState()?.line,
    requestRender: queueDecorationsRender,
  })

  function updateCursorStateFromTextarea(options?: CursorStateSyncOptions) {
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
    queueDecorationsRender()
  }

  extensions = attachBufferExtensions(props.extensions ?? [], {
    getCursor: () => cursorState(),
    getViewport: () => viewport.snapshot(),
    getRenderTarget: () => textareaAdapter.createRenderTarget(),
    getDocument: doc,
    setGutterMarkers: gutter.setMarkers,
    setSyntaxStyle: (style) => textareaAdapter.setSyntaxStyle(style),
    requestDecorationsRender: queueDecorationsRender,
  })

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
    accept: (item, range) => applyRangeEdit(range.start, range.end, item.insertText, item.cursorOffset),
  })

  const setCursorDocOffset = (offset: DocCharOffset, cause: BufferTextareaCursorChangeCause = "buffer") => {
    if (!textareaAdapter.readCursor()) {
      return false
    }

    viewport.resetCursorTracking()
    const next = doc().positionAtOffset(offset)
    textareaAdapter.setCursor(next.line, next.offset, cause)
    textareaAdapter.requestRender()
    return true
  }

  const applyRangeEdit = (
    start: DocCharOffset,
    end: DocCharOffset,
    insertText: string,
    nextCursorOffset = insertText.length,
  ) => {
    const document = doc()
    const from = document.positionAtOffset(start)
    const to = document.positionAtOffset(end)
    textareaAdapter.deleteRange(from.line, from.offset, to.line, to.offset)
    textareaAdapter.setCursor(from.line, from.offset, "buffer")
    textareaAdapter.insertTextWithCause(insertText, "buffer")
    if (nextCursorOffset !== insertText.length) {
      const prefix = insertText.slice(0, nextCursorOffset)
      const lines = prefix.split("\n")
      const lastLine = lines.at(-1) ?? ""
      viewport.resetCursorTracking()
      textareaAdapter.setCursor(
        from.line + lines.length - 1,
        lines.length === 1 ? from.offset + lastLine.length : lastLine.length,
        "buffer",
      )
    }
    return true
  }

  const deleteToLineStart = () => {
    const cursor = textareaAdapter.readCursor()
    if (!cursor) {
      return false
    }

    const document = doc()
    const offset = document.offsetAtLineChar(cursor.logicalRow, cursor.logicalCol)
    const atEof = cursor.logicalRow === document.lineStarts.length - 1 && offset === document.text.length
    if (!atEof) {
      return textareaAdapter.deleteToLineStart("buffer")
    }
    if (cursor.logicalCol > 0) {
      textareaAdapter.setCursor(cursor.logicalRow, 0, "buffer")
      let applied = false
      for (let i = 0; i < cursor.logicalCol; i += 1) {
        applied = textareaAdapter.deleteChar("buffer") || applied
      }
      return applied
    }
    if (cursor.logicalRow > 0) {
      return textareaAdapter.deleteCharBackward("buffer")
    }
    return false
  }

  const applyTextChange = (nextText: string, modified: boolean, change?: BufferTextChange) => {
    const edit = doc().applyText(nextText, modified)
    const next = edit.document
    if (next === doc()) {
      return
    }

    setDoc(next)
    textareaAdapter.resetMeasurements()
    extensions.emitDocumentChange({
      document: next,
      change: change ?? edit.change,
      reason: modified ? "edit" : "replace",
    })
    props.onTextChange(next.text, { modified: next.modified })
  }

  const focus = () => {
    textareaAdapter.focus()
  }

  const setText = (nextText: string) => {
    const normalizedText = normalizeDocumentText(nextText)
    const hasTextarea = textareaAdapter.readText() !== undefined
    applyTextChange(normalizedText, false)
    if (hasTextarea) {
      textareaAdapter.setText(normalizedText, "buffer")
      setCursorDocOffset(docCharOffset(0))
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
      if (autocomplete.isOpen()) {
        autocomplete.refreshOpenOnly()
      }
    })
  }

  const attachTextarea = (node: TextareaRenderable | undefined) => {
    textareaAdapter.attach(node)
    if (!node) {
      return
    }
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
        queueDecorationsRender.cancel()
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
    autocomplete.close()
    props.focusSelf()
  }

  const handleTextareaKeyDown = (event: KeyEvent) => {
    if (event.defaultPrevented || autocomplete.isOpen()) {
      return
    }

    if (event.name === "tab") {
      event.preventDefault()
      textareaAdapter.insertTextWithCause(tabText, "input")
      defer(() => {
        autocomplete.openFromEdit()
      })
      return
    }

    if (!shouldTriggerAutocompleteOnKeyDown(event)) {
      return
    }

    defer(() => {
      autocomplete.openFromEdit()
    })
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
    queueDecorationsRender.cancel()
    viewport.dispose()
    autocomplete.close()
    extensions.dispose()
    textareaAdapter.detach()
  })

  createEffect(() => {
    const state = {
      document: doc(),
      cursor: cursorState(),
    } satisfies BufferState
    props.onStateChange?.(state)
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

  extensions.emitDocumentChange({ document: doc(), reason: "initial" })

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
            <buffer_line_number
              ref={gutter.attach}
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
                onKeyDown={handleTextareaKeyDown}
                onMouseDown={handleTextareaMouseDown}
                onMouseScroll={viewport.handleTextareaMouseScroll}
                onPaste={() => autocomplete.close()}
                onContentChange={handleContentChange}
              />
            </buffer_line_number>
          </box>
        </OriScrollbox>
        <SelectPopup viewModel={autocomplete.viewModel} />
      </box>
    </KeyScope>
  )
}
