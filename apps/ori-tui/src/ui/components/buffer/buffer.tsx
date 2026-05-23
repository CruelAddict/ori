import type {
  BoxRenderable,
  LineNumberRenderable,
  MouseEvent,
  ScrollBoxRenderable,
  TextareaRenderable,
} from "@opentui/core"
import { getViewportBandY, getViewportInsetY, getViewportRect, OriScrollbox } from "@ui/components/ori-scrollbox"
import { SelectPopup } from "@ui/components/select-popup"
import type { SelectPopupAnchor } from "@ui/components/select-popup-model"
import { useTheme } from "@ui/providers/theme"
import { type KeyBinding, KeyScope } from "@ui/services/key-scopes"
import { debounce } from "@utils/debounce"
import { buildLineStarts, offsetToLineCol } from "@utils/line-offsets"
import { type Accessor, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import type { BufferAnalysis, BufferTextChange } from "./analysis"
import { createBufferAutocomplete } from "./autocomplete/controller"
import type { BufferAutocompleteProvider } from "./autocomplete/types"
import { createBufferOpentuiAdapter } from "./buffer-opentui-adapter"
import type { DocCharOffset } from "./coords"
import { containerHeight, containerWidth, containerX, containerY, docCharOffset } from "./coords"

const DEBOUNCE_MS = 200
const DEFAULT_TAB_WIDTH = 2
const EMPTY_GUTTER_MARKERS = new Map<number, string>()

type PendingChangeOrigin = {
  origin: "user" | "autocomplete"
  remainingEvents: number
}

function findTextChange(previous: string, next: string): BufferTextChange | undefined {
  if (previous === next) {
    return undefined
  }

  const limit = Math.min(previous.length, next.length)
  let prefix = 0
  for (; prefix < limit; prefix += 1) {
    if (previous[prefix] !== next[prefix]) {
      break
    }
  }

  const suffixLimit = Math.min(previous.length - prefix, next.length - prefix)
  let suffix = 0
  for (; suffix < suffixLimit; suffix += 1) {
    if (previous[previous.length - 1 - suffix] !== next[next.length - 1 - suffix]) {
      break
    }
  }

  return {
    start: prefix,
    previousEnd: previous.length - suffix,
    nextEnd: next.length - suffix,
  }
}

export type BufferApi = {
  setText: (text: string) => void
  focus: () => void
  getCursorOffset: () => DocCharOffset | undefined
}

export type BufferContext = {
  text: string
  lineStarts: number[]
  focusedRow: number
  cursorOffset: DocCharOffset | undefined
  documentVersion: number
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
  onContextChange?: (context: BufferContext) => void
  autocomplete?: BufferAutocompleteProvider
  analysis?: BufferAnalysis
}

export function Buffer(props: BufferProps) {
  const { theme } = useTheme()
  const palette = theme

  const tabWidth = Math.max(1, props.tabWidth ?? DEFAULT_TAB_WIDTH)
  const [text, setTextState] = createSignal(props.initialText)
  const [contentModified, setContentModified] = createSignal(false)
  const [documentVersion, setDocumentVersion] = createSignal(0)
  const [lineStarts, setLineStartsState] = createSignal(buildLineStarts(props.initialText))

  const [viewportHeight, setViewportHeight] = createSignal(1)
  const [totalRows, setTotalRows] = createSignal(1)

  const [cursorState, setCursorState] = createSignal({
    row: 0,
    offset: docCharOffset(0),
  })
  const cursorOffset = createMemo(() => cursorState().offset)
  const focusedRow = createMemo(() => cursorState().row)

  let scrollRef: ScrollBoxRenderable | undefined
  let bufferRootRef: BoxRenderable | undefined
  let gutterRef: LineNumberRenderable | undefined
  let previousFocusState = props.isFocused()
  let disposed = false
  let syncQueued = false
  let cursorSyncMode = "queued" as "queued" | "inline"
  let pendingScrollboxTop: number | undefined
  let scrollboxIntentQueued = false
  let viewportWidth = 0
  let viewportRows = 0
  let lastEditorScrollMargin = -1
  let lastScrollboxMetrics = {
    verticalScrollSize: -1,
    verticalViewportSize: -1,
    horizontalScrollSize: -1,
    horizontalViewportSize: -1,
  }
  let initialContextFlushQueued = false
  let initialContextPending = true
  let pendingInitialContext: BufferContext | undefined
  let pendingChangeOrigin: PendingChangeOrigin | undefined
  let pendingReset = false

  const bufferMicrotask = (callback: () => void) => {
    queueMicrotask(() => {
      if (disposed) {
        return
      }
      callback()
    })
  }

  const syncCursorStateFromEditor = (mode: "queued" | "inline" = "queued") => {
    const next = adapter.readCursorState()
    if (!next) {
      return
    }

    setCursorState(next)
    if (mode === "inline") {
      syncActiveLineColor()
      return
    }

    queueSync()
  }

  const adapter = createBufferOpentuiAdapter({
    tabWidth,
    getText: text,
    getLineStarts: lineStarts,
    onLineInfoChange: () => {
      queueSync()
    },
    onCursorSync: () => {
      syncCursorStateFromEditor(cursorSyncMode)
    },
  })

  const debouncedPush = debounce(() => {
    props.onTextChange(text(), { modified: contentModified() })
  }, DEBOUNCE_MS)

  const analysisSession = props.analysis?.createSession({
    tabWidth,
    getRef: () => adapter.live(),
    getLineInfo: adapter.getLineInfo,
    getText: text,
    getLineStarts: lineStarts,
    getVersion: documentVersion,
    getFocusedRow: focusedRow,
    requestSync: () => queueSync(),
  })

  const autocomplete = createBufferAutocomplete({
    provider: () => props.autocomplete,
    isFocused: props.isFocused,
    getText: text,
    getCursorOffset: () => cursorOffset(),
    resolveAnchor: (replaceStart) => getAnchor(replaceStart),
    accept: (item, range) => replaceDocumentRange(range.start, range.end, item.insertText, item.cursorOffset),
  })

  const flushInitialContextChange = () => {
    initialContextFlushQueued = false
    if (disposed) {
      return
    }

    const context = pendingInitialContext
    if (!context) {
      return
    }

    pendingInitialContext = undefined
    initialContextPending = false
    props.onContextChange?.(context)
  }

  const scheduleContextChange = (context: BufferContext) => {
    if (!props.onContextChange) {
      return
    }
    if (!initialContextPending) {
      props.onContextChange(context)
      return
    }

    pendingInitialContext = context
    if (initialContextFlushQueued) {
      return
    }

    initialContextFlushQueued = true
    queueMicrotask(flushInitialContextChange)
  }

  const getTotalRowsForViewport = (_ref: TextareaRenderable, nextViewportHeight: number) => {
    return Math.max(nextViewportHeight, adapter.measureRows(nextViewportHeight, documentVersion()))
  }

  const syncScrollMetrics = (ref: TextareaRenderable, nextViewportHeight: number) => {
    const height = Math.max(1, nextViewportHeight)
    const margin = getViewportInsetY({ height }) / height
    if (margin !== lastEditorScrollMargin) {
      lastEditorScrollMargin = margin
      ref.editorView.setScrollMargin(margin)
    }
    setViewportHeight(height)
    setTotalRows(getTotalRowsForViewport(ref, height))
  }

  const syncScrollboxTop = (top: number) => {
    if (!scrollRef) {
      return
    }
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

    const nextMetrics = {
      verticalScrollSize: scrollRef.scrollHeight,
      verticalViewportSize: scrollRef.viewport.height,
      horizontalScrollSize: scrollRef.scrollWidth,
      horizontalViewportSize: scrollRef.viewport.width,
    }
    if (nextMetrics.verticalScrollSize !== lastScrollboxMetrics.verticalScrollSize) {
      scrollRef.verticalScrollBar.scrollSize = nextMetrics.verticalScrollSize
    }
    if (nextMetrics.verticalViewportSize !== lastScrollboxMetrics.verticalViewportSize) {
      scrollRef.verticalScrollBar.viewportSize = nextMetrics.verticalViewportSize
    }
    if (nextMetrics.horizontalScrollSize !== lastScrollboxMetrics.horizontalScrollSize) {
      scrollRef.horizontalScrollBar.scrollSize = nextMetrics.horizontalScrollSize
    }
    if (nextMetrics.horizontalViewportSize !== lastScrollboxMetrics.horizontalViewportSize) {
      scrollRef.horizontalScrollBar.viewportSize = nextMetrics.horizontalViewportSize
    }
    lastScrollboxMetrics = nextMetrics
  }

  const noteUserScroll = () => {
    adapter.noteManualScroll()
  }

  const syncLineNumberViewportHeight = () => {
    if (!gutterRef || gutterRef.isDestroyed) {
      return
    }

    const height = viewportHeight()
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
      colors.set(focusedRow(), {
        gutter: palette().get("editor_active_line_background"),
        content: palette().get("editor_active_line_background"),
      })
    }
    gutterRef.setLineColors(colors)
  }

  const setEditorViewport = (top: number, nextHeight = adapter.live()?.height ?? 1, moveCursor = false) => {
    const ref = adapter.live()
    if (!ref) {
      return
    }

    const viewport = ref.editorView.getViewport()
    const height = Math.max(1, nextHeight)
    const margin = getViewportInsetY({ height }) / height
    if (margin !== lastEditorScrollMargin) {
      lastEditorScrollMargin = margin
      ref.editorView.setScrollMargin(margin)
    }
    const nextTop = Math.max(0, Math.min(top, Math.max(0, getTotalRowsForViewport(ref, height) - height)))
    if (viewport.offsetY === nextTop && viewport.width === ref.width && viewport.height === height) {
      pendingScrollboxTop = undefined
      syncScrollMetrics(ref, height)
      syncScrollboxTop(ref.scrollY)
      return
    }

    pendingScrollboxTop = moveCursor ? nextTop : undefined
    cursorSyncMode = moveCursor ? "inline" : "queued"
    adapter.setViewport(viewport.offsetX, nextTop, Math.max(1, ref.width), height, moveCursor)
    cursorSyncMode = "queued"
    ref.requestRender()
    if (!moveCursor && scrollRef && (scrollRef.scrollTop ?? 0) !== ref.scrollY) {
      scrollRef.scrollTo({ x: 0, y: ref.scrollY })
    }
  }

  const syncScrollboxFromEditor = () => {
    const ref = adapter.live()
    if (!scrollRef || !ref) {
      return
    }

    syncScrollboxBarMetrics()
    const viewport = getViewportRect(scrollRef)
    const height = Math.max(1, viewport.height)
    const maxTop = Math.max(0, getTotalRowsForViewport(ref, height) - height)
    if (pendingScrollboxTop !== undefined && ref.scrollY === pendingScrollboxTop) {
      pendingScrollboxTop = undefined
    }
    if (ref.scrollY > maxTop) {
      setEditorViewport(maxTop, height)
      return
    }

    syncScrollMetrics(ref, height)
    syncScrollboxTop(ref.scrollY)
  }

  const applyScrollboxIntent = () => {
    scrollboxIntentQueued = false
    if (!scrollRef) {
      return
    }

    syncScrollboxBarMetrics()
    const viewport = getViewportRect(scrollRef)
    setViewportHeight(Math.max(1, viewport.height))
    const ref = adapter.live()
    const nextTop = scrollRef.scrollTop ?? 0
    let moveCursor = true
    if (ref) {
      const editorViewport = ref.editorView.getViewport()
      const currentRow = editorViewport.offsetY + ref.visualCursor.visualRow
      const band = getViewportBandY({ height: viewport.height })
      moveCursor = currentRow < nextTop + band.start || currentRow > nextTop + band.end
    }
    setEditorViewport(nextTop, viewport.height, moveCursor)
    analysisSession?.sync({ scheduleUpdate: false })
    scrollRef.content.translateY = 0
  }

  const queueScrollboxIntent = () => {
    if (scrollRef) {
      scrollRef.content.translateY = 0
    }
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

    const ref = adapter.live()
    if (!ref) {
      return
    }

    if (pendingScrollboxTop !== undefined) {
      if (ref.scrollY === pendingScrollboxTop) {
        pendingScrollboxTop = undefined
        queueSync()
      }
      if ((scrollRef.scrollTop ?? 0) === pendingScrollboxTop) {
        return
      }
      pendingScrollboxTop = undefined
    }

    if ((scrollRef.scrollTop ?? 0) !== ref.scrollY) {
      syncScrollboxTop(ref.scrollY)
      return
    }
  }

  const syncLayout = () => {
    syncQueued = false
    syncScrollboxFromEditor()
    syncActiveLineColor()
    syncLineNumberViewportHeight()
    analysisSession?.sync()
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
    const ref = adapter.live()
    if (!bufferRootRef || !ref) {
      return null
    }

    const point = adapter.resolveViewportPoint(replaceStart)
    if (!point) {
      return null
    }

    return {
      x: containerX(Math.max(0, ref.x + point.x - bufferRootRef.x - 1)),
      y: containerY(Math.max(0, ref.y + point.y - bufferRootRef.y)),
      containerWidth: containerWidth(bufferRootRef.width),
      containerHeight: containerHeight(bufferRootRef.height),
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
    const replaced = adapter.replaceDocRange(start, end, insertText, nextCursorOffset)
    if (!replaced) {
      return false
    }
    bufferMicrotask(() => {
      syncCursorStateFromEditor()
    })
    return true
  }

  const deleteToLineStart = () => {
    const currentOffset = cursorOffset()
    if (currentOffset === undefined) {
      return false
    }

    const current = text()
    const offset = Number(currentOffset)
    const starts = lineStarts()
    const cursor = offsetToLineCol(offset, starts)
    const lineStart = starts[cursor.line] ?? 0
    const needsEofWorkaround = cursor.line === starts.length - 1 && offset === current.length

    if (cursor.col > 0) {
      if (needsEofWorkaround) {
        const nextText = current.slice(0, lineStart) + current.slice(offset)
        return replaceDocumentRange(docCharOffset(0), docCharOffset(current.length), nextText, lineStart, "user")
      }
      return replaceDocumentRange(docCharOffset(lineStart), docCharOffset(offset), "", 0, "user")
    }

    if (cursor.line > 0) {
      if (needsEofWorkaround) {
        const nextCursorOffset = lineStart - 1
        const nextText = current.slice(0, nextCursorOffset) + current.slice(lineStart)
        return replaceDocumentRange(docCharOffset(0), docCharOffset(current.length), nextText, nextCursorOffset, "user")
      }
      return replaceDocumentRange(docCharOffset(lineStart - 1), docCharOffset(lineStart), "", 0, "user")
    }

    return true
  }

  const flush = () => {
    debouncedPush.clear()
    props.onTextChange(text(), { modified: contentModified() })
  }

  const applyTextChange = (nextText: string, modified: boolean, change = findTextChange(text(), nextText)) => {
    const version = documentVersion() + 1
    const starts = buildLineStarts(nextText)
    analysisSession?.rebuild(nextText, starts, version, change)
    setTextState(nextText)
    setLineStartsState(starts)
    setContentModified(modified)
    setDocumentVersion(version)
    adapter.resetMeasuredRows()
    debouncedPush()
  }

  const focus = () => {
    adapter.live()?.focus()
  }

  const setText = (nextText: string) => {
    const ref = adapter.live()
    pendingReset = true
    analysisSession?.reset()
    if (ref) {
      ref.setText(nextText)
      adapter.setCursorDocOffset(docCharOffset(0))
    }
    if (!ref) {
      applyTextChange(nextText, false)
    }
    setCursorState({ row: 0, offset: docCharOffset(0) })
    queueSync()
  }

  const handleContentChange = () => {
    const ref = adapter.live()
    if (!ref) {
      return
    }

    const change = findTextChange(text(), ref.plainText)
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

    const modified = !pendingReset
    if (!change && ref.plainText === text() && modified === contentModified()) {
      pendingReset = false
      syncCursorStateFromEditor("queued")
      queueSync()
      return
    }
    pendingReset = false
    applyTextChange(ref.plainText, modified, change)
    syncCursorStateFromEditor("queued")
    queueSync()
    if (origin === "user") {
      bufferMicrotask(() => {
        autocomplete.refresh()
      })
    }
  }

  const bindings: KeyBinding[] = [
    {
      pattern: "escape",
      handler: () => {
        flush()
        props.onUnfocus?.()
      },
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

  onMount(() => {
    props.registerApi?.({
      setText,
      focus,
      getCursorOffset: () => cursorOffset(),
    })
  })

  onCleanup(() => {
    disposed = true
    syncQueued = false
    scrollboxIntentQueued = false
    pendingInitialContext = undefined
    debouncedPush.clear()
    autocomplete.close()
    analysisSession?.dispose()
    adapter.detach()
  })

  createEffect(() => {
    const context = {
      text: text(),
      lineStarts: lineStarts(),
      focusedRow: focusedRow(),
      cursorOffset: cursorOffset(),
      documentVersion: documentVersion(),
    } satisfies BufferContext
    scheduleContextChange(context)
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
    focusedRow()
    syncActiveLineColor()
  })

  createEffect(() => {
    const isFocused = props.isFocused()
    if (isFocused === previousFocusState) {
      return
    }
    previousFocusState = isFocused
    if (!isFocused) {
      adapter.live()?.blur()
      autocomplete.close()
      return
    }
    bufferMicrotask(() => {
      adapter.live()?.focus()
      queueSync()
    })
  })

  analysisSession?.rebuild(props.initialText, buildLineStarts(props.initialText), documentVersion())

  return (
    <KeyScope
      bindings={bindings}
      enabled={props.isFocused}
    >
      <box
        ref={(node) => {
          bufferRootRef = node
        }}
        position="relative"
        flexDirection="column"
        flexGrow={1}
        backgroundColor={palette().get("editor_background")}
      >
        <OriScrollbox
          marginTop={1}
          stickyScroll={false}
          scrollX={false}
          onReady={(node) => {
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
          }}
          onSync={handleScrollboxSync}
          onUserScroll={() => {
            noteUserScroll()
            autocomplete.close()
            queueScrollboxIntent()
          }}
          height="100%"
          horizontalScrollbarOptions={{
            trackOptions: {
              backgroundColor: palette().get("editor_background"),
            },
          }}
          verticalScrollbarOptions={{
            trackOptions: {
              backgroundColor: palette().get("editor_background"),
            },
          }}
          minVerticalThumbHeight={2}
        >
          <box
            position="relative"
            flexDirection="column"
            backgroundColor={palette().get("editor_background")}
            width="100%"
          >
            <box
              height={totalRows()}
              minHeight={totalRows()}
              maxHeight={totalRows()}
            />
            <line_number
              ref={(node: LineNumberRenderable | undefined) => {
                gutterRef = node
                queueSync()
              }}
              position="absolute"
              top={0}
              left={0}
              width="100%"
              height={viewportHeight()}
              minHeight={viewportHeight()}
              maxHeight={viewportHeight()}
              fg={palette().get("text_muted")}
              bg={palette().get("editor_background")}
              paddingRight={1}
              minWidth={5}
            >
              <textarea
                ref={(node: TextareaRenderable | undefined) => {
                  adapter.attach(node)
                  if (!node) {
                    return
                  }
                  node.syntaxStyle = props.analysis?.syntaxStyle() ?? null
                  queueSync()
                  setTimeout(() => {
                    if (disposed || adapter.live() !== node) {
                      return
                    }
                    node.flexShrink = 1
                    queueSync()
                  }, 0)
                  if (props.isFocused()) {
                    bufferMicrotask(() => {
                      adapter.live()?.focus()
                    })
                  }
                }}
                height={viewportHeight()}
                minHeight={viewportHeight()}
                maxHeight={viewportHeight()}
                width="100%"
                flexGrow={1}
                flexShrink={1}
                initialValue={props.initialText}
                textColor={palette().get("editor_text")}
                focusedTextColor={palette().get("editor_text")}
                backgroundColor="transparent"
                focusedBackgroundColor="transparent"
                cursorColor={palette().get("editor_cursor")}
                wrapMode="char"
                selectable={true}
                keyBindings={[]}
                onMouseDown={(event: MouseEvent) => {
                  event.stopPropagation()
                  props.focusSelf()
                }}
                onMouseScroll={(_event: MouseEvent) => {
                  noteUserScroll()
                  props.focusSelf()
                }}
                onCursorChange={() => {
                  syncCursorStateFromEditor(cursorSyncMode)
                }}
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
