import type {
  BoxRenderable,
  LineNumberRenderable,
  MouseEvent,
  ScrollBoxRenderable,
  TextareaRenderable,
} from "@opentui/core"
import { getViewportRect, OriScrollbox } from "@ui/components/ori-scrollbox"
import { SelectPopup } from "@ui/components/select-popup"
import type { SelectPopupAnchor } from "@ui/components/select-popup-model"
import { useLogger } from "@ui/providers/logger"
import { useTheme } from "@ui/providers/theme"
import { type KeyBinding, KeyScope } from "@ui/services/key-scopes"
import { debounce } from "@utils/debounce"
import { buildLineStarts, offsetToLineCol } from "@utils/line-offsets"
import { syntaxHighlighter } from "@utils/syntax-highlighter"
import { type Accessor, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { createBufferAutocomplete } from "./autocomplete/controller"
import type { BufferAutocompleteProvider } from "./autocomplete/types"
import { createBufferOpentuiAdapter } from "./buffer-opentui-adapter"
import {
  addStatementHighlightSpanLines,
  applyStatementBatch,
  buildStatementBatch,
  buildStatementCache,
  collectVisibleStatementIndices,
  collectVisibleStatements,
  getLineText,
  hasDirtyStatements,
  type StatementCache,
  type StatementEntry,
} from "./buffer-statement-cache"
import type { DocCharOffset } from "./coords"
import { docCharOffset, lineCharOffset } from "./coords"
import { lineCharOffsetToDisplayColumn } from "./text-metrics"

const DEBOUNCE_MS = 200
const DEFAULT_TAB_WIDTH = 2
const EMPTY_GUTTER_MARKERS = new Map<number, string>()
const VISIBLE_OVERSCAN_ROWS = 8
const WARM_OVERSCAN_ROWS = 24
const HIGHLIGHT_BACKFILL_QUIET_MS = 180
const HIGHLIGHT_BACKFILL_BATCH_STATEMENTS = 64
const HIGHLIGHT_BACKFILL_BATCH_CHARS = 24_000

type PendingChangeOrigin = {
  origin: "user" | "autocomplete"
  remainingEvents: number
}

type MaterializedHighlightEntry = {
  hlRef: number
  version: number
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
  language?: string
  isFocused: Accessor<boolean>
  onTextChange: (text: string, info: { modified: boolean }) => void
  onUnfocus?: () => void
  registerApi?: (api: BufferApi) => void
  focusSelf: () => void
  gutterMarkers?: Accessor<ReadonlyMap<number, string>>
  onContextChange?: (context: BufferContext) => void
  autocomplete?: BufferAutocompleteProvider
}

export function Buffer(props: BufferProps) {
  const { theme } = useTheme()
  const palette = theme
  const logger = useLogger()
  const highlighter = syntaxHighlighter({
    theme: palette,
    language: props.language ?? "sql",
    logger,
  })

  const tabWidth = Math.max(1, props.tabWidth ?? DEFAULT_TAB_WIDTH)
  const [text, setTextState] = createSignal(props.initialText)
  const [contentModified, setContentModified] = createSignal(false)
  const [documentVersion, setDocumentVersion] = createSignal(0)
  const [viewportHeight, setViewportHeight] = createSignal(1)
  const [scrollTop, setScrollTop] = createSignal(0)
  const [totalRows, setTotalRows] = createSignal(1)
  const [cursorState, setCursorState] = createSignal({
    row: 0,
    offset: docCharOffset(0),
  })
  const lineStarts = createMemo(() => buildLineStarts(text()))
  const cursorOffset = createMemo(() => cursorState().offset)
  const focusedRow = createMemo(() => cursorState().row)

  let scrollRef: ScrollBoxRenderable | undefined
  let containerRef: BoxRenderable | undefined
  let gutterRef: LineNumberRenderable | undefined
  let previousFocusState = props.isFocused()
  let disposed = false
  let syncQueued = false
  let viewportWidth = 0
  let viewportRows = 0
  let initialContextFlushQueued = false
  let initialContextPending = true
  let pendingInitialContext: BufferContext | undefined
  let pendingChangeOrigin: PendingChangeOrigin | undefined
  let pendingReset = false
  let statementId = 0
  let statementCache: StatementCache | undefined
  let previousStatements: StatementEntry[] = []
  let appliedHighlightVersion = -1
  let appliedHighlightStyle = highlighter.highlightResult().syntaxStyle
  let materializedStatementRefs = new Map<string, MaterializedHighlightEntry>()
  let statementHighlightRef = 1
  let highlightEpoch = 0
  let highlightQueued = false
  let highlightRunning = false
  let highlightBackfillTimer: ReturnType<typeof setTimeout> | undefined
  let highlightBackfillCursor = 0
  let lastEditAt = performance.now()

  const bufferMicrotask = (callback: () => void) => {
    queueMicrotask(() => {
      if (disposed) {
        return
      }
      callback()
    })
  }

  const syncCursorStateFromEditor = (shouldQueue = true) => {
    const next = adapter.readCursorState()
    if (!next) {
      return
    }

    setCursorState(next)
    if (!shouldQueue) {
      return
    }

    queueSync()
  }

  const adapter = createBufferOpentuiAdapter({
    tabWidth,
    onLineInfoChange: () => {
      queueSync()
    },
    onCursorSync: () => {
      syncCursorStateFromEditor()
    },
  })

  const debouncedPush = debounce(() => {
    props.onTextChange(text(), { modified: contentModified() })
  }, DEBOUNCE_MS)

  const nextStatementId = () => {
    const id = `statement-${statementId}`
    statementId += 1
    return id
  }

  const nextStatementHighlightRef = () => {
    const ref = statementHighlightRef
    statementHighlightRef += 1
    return ref
  }

  const clearHighlightBackfillTimer = () => {
    if (highlightBackfillTimer === undefined) {
      return
    }

    clearTimeout(highlightBackfillTimer)
    highlightBackfillTimer = undefined
  }

  const scheduleHighlightDrain = () => {
    if (disposed || highlightQueued) {
      return
    }

    highlightQueued = true
    queueMicrotask(() => {
      highlightQueued = false
      runHighlightDrain()
    })
  }

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
    setViewportHeight(height)
    setScrollTop(ref.scrollY)
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

  const syncLineDecorations = () => {
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

    const colors = new Map<number, { gutter: string; content: string }>()
    if (props.isFocused()) {
      colors.set(focusedRow(), {
        gutter: palette().get("editor_active_line_background"),
        content: palette().get("editor_active_line_background"),
      })
    }
    gutterRef.setLineColors(colors)
  }

  const rebuildStatementCache = (nextText: string, nextLineStarts: number[], version: number) => {
    statementCache = buildStatementCache(
      nextText,
      nextLineStarts,
      previousStatements,
      nextStatementId,
      highlighter.highlightResult().syntaxStyle,
      version,
    )
    previousStatements = statementCache.statements
    scheduleHighlightDrain()
  }

  const clearRenderedHighlights = (requestRender: boolean) => {
    const ref = adapter.live()
    const refs = materializedStatementRefs
    materializedStatementRefs = new Map()
    appliedHighlightVersion = -1
    if (!ref || refs.size === 0) {
      if (requestRender) {
        ref?.requestRender()
      }
      return
    }

    for (const entry of refs.values()) {
      ref.editBuffer.removeHighlightsByRef(entry.hlRef)
    }
    if (requestRender) {
      ref.requestRender()
    }
  }

  const invalidateMaterializedHighlights = () => {
    if (materializedStatementRefs.size === 0) {
      return
    }

    materializedStatementRefs = new Map(
      [...materializedStatementRefs].map(([id, entry]) => [id, { hlRef: entry.hlRef, version: -1 }]),
    )
  }

  const buildWarmBatch = () => {
    const ref = adapter.live()
    const cache = statementCache
    if (!ref || !cache) {
      return undefined
    }

    const indices = collectVisibleStatementIndices(
      cache,
      ref.lineInfo,
      ref.scrollY,
      ref.height,
      focusedRow(),
      WARM_OVERSCAN_ROWS,
    )
    const dirtyIndices = indices.filter((index) => cache.statements[index]?.dirty)
    if (dirtyIndices.length === 0) {
      return undefined
    }

    return buildStatementBatch(cache, text(), dirtyIndices[0] ?? 0, dirtyIndices[dirtyIndices.length - 1] ?? 0)
  }

  const findNextDirtyStatementIndex = (cache: StatementCache, startIndex: number) => {
    for (let index = startIndex; index < cache.statements.length; index += 1) {
      if (cache.statements[index]?.dirty) {
        return index
      }
    }
    for (let index = 0; index < startIndex; index += 1) {
      if (cache.statements[index]?.dirty) {
        return index
      }
    }

    return undefined
  }

  const buildBackfillBatch = () => {
    const cache = statementCache
    if (!cache) {
      return undefined
    }

    const startIndex = findNextDirtyStatementIndex(cache, highlightBackfillCursor)
    if (startIndex === undefined) {
      return undefined
    }

    const first = cache.statements[startIndex]
    if (!first) {
      return undefined
    }

    let endIndex = startIndex
    for (
      let count = 1;
      count < HIGHLIGHT_BACKFILL_BATCH_STATEMENTS && endIndex + 1 < cache.statements.length;
      count += 1
    ) {
      const next = cache.statements[endIndex + 1]
      if (!next) {
        break
      }
      if (next.end - first.start > HIGHLIGHT_BACKFILL_BATCH_CHARS) {
        break
      }
      endIndex += 1
    }

    return buildStatementBatch(cache, text(), startIndex, endIndex)
  }

  const runHighlightDrain = () => {
    if (disposed || highlightRunning) {
      return
    }

    const cache = statementCache
    if (!cache || !hasDirtyStatements(cache)) {
      clearHighlightBackfillTimer()
      return
    }

    const warmBatch = buildWarmBatch()
    if (warmBatch) {
      void runHighlightBatch(warmBatch)
      return
    }

    const remainingQuietMs = lastEditAt + HIGHLIGHT_BACKFILL_QUIET_MS - performance.now()
    if (remainingQuietMs > 0) {
      if (highlightBackfillTimer === undefined) {
        highlightBackfillTimer = setTimeout(() => {
          highlightBackfillTimer = undefined
          scheduleHighlightDrain()
        }, remainingQuietMs)
      }
      return
    }

    const backfillBatch = buildBackfillBatch()
    if (!backfillBatch) {
      clearHighlightBackfillTimer()
      return
    }

    void runHighlightBatch(backfillBatch)
  }

  const runHighlightBatch = async (batch: NonNullable<ReturnType<typeof buildStatementBatch>>) => {
    const epoch = highlightEpoch
    const cache = statementCache
    if (!cache) {
      return
    }

    highlightRunning = true
    try {
      const spans = await highlighter.highlightText(batch.text)
      if (disposed || epoch !== highlightEpoch || statementCache !== cache) {
        return
      }

      applyStatementBatch(cache, batch, spans)
      previousStatements = cache.statements
      highlightBackfillCursor = Math.min(batch.endIndex + 1, Math.max(0, cache.statements.length - 1))
      queueSync()
    } catch (err) {
      if (!disposed && epoch === highlightEpoch) {
        logger.error({ err }, "buffer: statement highlight failed")
      }
    } finally {
      highlightRunning = false
      scheduleHighlightDrain()
    }
  }

  const syncRenderedHighlights = () => {
    const ref = adapter.live()
    if (!ref || !statementCache) {
      clearRenderedHighlights(false)
      return
    }

    if (appliedHighlightStyle !== statementCache.syntaxStyle) {
      appliedHighlightStyle = statementCache.syntaxStyle
      ref.syntaxStyle = statementCache.syntaxStyle
    }

    const statements = collectVisibleStatements(
      statementCache,
      ref.lineInfo,
      ref.scrollY,
      ref.height,
      focusedRow(),
      VISIBLE_OVERSCAN_ROWS,
    )
    const visibleIds = new Set(statements.map((statement) => statement.id))
    const starts = lineStarts()
    const value = text()
    let changed = appliedHighlightVersion !== documentVersion()

    for (const [id, entry] of materializedStatementRefs) {
      if (visibleIds.has(id)) {
        continue
      }

      ref.editBuffer.removeHighlightsByRef(entry.hlRef)
      materializedStatementRefs.delete(id)
      changed = true
    }

    for (const statement of statements) {
      const current = materializedStatementRefs.get(statement.id)
      if (current?.version === statement.highlightVersion) {
        continue
      }

      const hlRef = current?.hlRef ?? nextStatementHighlightRef()
      if (current) {
        ref.editBuffer.removeHighlightsByRef(hlRef)
      }

      for (const span of statement.spans) {
        addStatementHighlightSpanLines({
          ref,
          span,
          starts,
          text: value,
          tabWidth,
          hlRef,
        })
      }

      materializedStatementRefs.set(statement.id, {
        hlRef,
        version: statement.highlightVersion,
      })
      changed = true
    }

    if (!changed) {
      return
    }

    appliedHighlightVersion = documentVersion()
    ref.requestRender()
  }

  const setEditorViewport = (top: number, nextHeight = adapter.live()?.height ?? 1, moveCursor = false) => {
    const ref = adapter.live()
    if (!ref) {
      return
    }

    const viewport = ref.editorView.getViewport()
    const height = Math.max(1, nextHeight)
    const nextTop = Math.max(0, Math.min(top, Math.max(0, getTotalRowsForViewport(ref, height) - height)))
    if (viewport.offsetY === nextTop && viewport.width === ref.width && viewport.height === height) {
      syncScrollMetrics(ref, height)
      syncScrollboxTop(ref.scrollY)
      return
    }

    ref.editorView.setViewport(viewport.offsetX, nextTop, Math.max(1, ref.width), height, moveCursor)
    ref.requestRender()
    if (scrollRef && (scrollRef.scrollTop ?? 0) !== ref.scrollY) {
      scrollRef.scrollTo({ x: 0, y: ref.scrollY })
    }
  }

  const syncScrollboxFromEditor = () => {
    const ref = adapter.live()
    if (!scrollRef || !ref) {
      return
    }

    const viewport = getViewportRect(scrollRef)
    syncScrollMetrics(ref, viewport.height)
    syncScrollboxTop(ref.scrollY)
  }

  const applyScrollboxIntent = () => {
    if (!scrollRef) {
      return
    }

    const viewport = getViewportRect(scrollRef)
    setViewportHeight(Math.max(1, viewport.height))
    setScrollTop(scrollRef.scrollTop ?? 0)
    setEditorViewport(scrollRef.scrollTop ?? 0, viewport.height, true)
  }

  const handleScrollboxSync = () => {
    if (!scrollRef) {
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

    if ((scrollRef.scrollTop ?? 0) !== ref.scrollY) {
      syncScrollboxTop(ref.scrollY)
    }
  }

  const syncLayout = () => {
    syncQueued = false
    syncScrollboxFromEditor()
    syncLineDecorations()
    syncLineNumberViewportHeight()
    syncRenderedHighlights()
    scheduleHighlightDrain()
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
    if (!containerRef || !ref) {
      return null
    }

    const currentOffset = cursorOffset()
    const anchorOffset = currentOffset !== undefined && currentOffset >= replaceStart ? currentOffset : replaceStart
    const anchorCursor = offsetToLineCol(anchorOffset, lineStarts())
    const replaceCursor = offsetToLineCol(replaceStart, lineStarts())
    const cursor = anchorCursor.line === replaceCursor.line ? anchorCursor : replaceCursor

    const lineText = getLineText(text(), lineStarts(), cursor.line)
    const displayCol = lineCharOffsetToDisplayColumn(
      { tabWidth, widthMethod: ref.ctx?.widthMethod },
      lineText,
      lineCharOffset(cursor.col),
    )
    const info = ref.lineInfo
    let visualRow = -1
    for (let index = 0; index < info.lineSources.length; index += 1) {
      if (info.lineSources[index] !== cursor.line) {
        continue
      }
      const nextStartCol =
        info.lineSources[index + 1] === cursor.line
          ? (info.lineStartCols[index + 1] ?? Number.POSITIVE_INFINITY)
          : Number.POSITIVE_INFINITY
      if (displayCol < nextStartCol || nextStartCol === Number.POSITIVE_INFINITY) {
        visualRow = index
        break
      }
    }
    if (visualRow < 0) {
      return null
    }

    const viewportRow = visualRow - ref.scrollY
    if (viewportRow < 0 || viewportRow >= ref.height) {
      return null
    }

    return {
      x: Math.max(0, ref.x + displayCol - (info.lineStartCols[visualRow] ?? 0) - containerRef.x - 1),
      y: Math.max(0, ref.y + viewportRow - containerRef.y),
      containerWidth: containerRef.width,
      containerHeight: containerRef.height,
    }
  }

  const replaceDocumentRange = (
    start: DocCharOffset,
    end: DocCharOffset,
    insertText: string,
    nextCursorOffset?: number,
  ) => {
    const ref = adapter.live()
    if (!ref) {
      return false
    }

    pendingChangeOrigin = {
      origin: "autocomplete",
      remainingEvents: start === end ? 1 : 2,
    }
    ref.editorView.setSelection(start, end)
    ref.insertText(insertText)
    bufferMicrotask(() => {
      const live = adapter.live()
      if (!live) {
        return
      }

      live.cursorOffset = start + (nextCursorOffset ?? insertText.length)
      syncCursorStateFromEditor()
    })
    return true
  }

  const flush = () => {
    debouncedPush.clear()
    props.onTextChange(text(), { modified: contentModified() })
  }

  const applyTextChange = (nextText: string, modified: boolean) => {
    const version = documentVersion() + 1
    const starts = buildLineStarts(nextText)
    highlightEpoch += 1
    highlightBackfillCursor = 0
    lastEditAt = performance.now()
    clearHighlightBackfillTimer()
    setTextState(nextText)
    setContentModified(modified)
    setDocumentVersion(version)
    adapter.resetMeasuredRows()
    rebuildStatementCache(nextText, starts, version)
    debouncedPush()
  }

  const focus = () => {
    adapter.live()?.focus()
  }

  const setText = (nextText: string) => {
    const ref = adapter.live()
    pendingReset = true
    highlightEpoch += 1
    highlightBackfillCursor = 0
    lastEditAt = performance.now()
    clearHighlightBackfillTimer()
    clearRenderedHighlights(false)
    statementCache = undefined
    previousStatements = []
    appliedHighlightStyle = highlighter.highlightResult().syntaxStyle
    if (ref) {
      ref.setText(nextText)
      ref.cursorOffset = 0
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
    pendingReset = false
    invalidateMaterializedHighlights()
    syncCursorStateFromEditor(false)
    applyTextChange(ref.plainText, modified)
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
    pendingInitialContext = undefined
    debouncedPush.clear()
    autocomplete.close()
    highlightEpoch += 1
    clearHighlightBackfillTimer()
    adapter.detach()
    clearRenderedHighlights(false)
    highlighter.dispose()
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
    const style = highlighter.highlightResult().syntaxStyle
    if (statementCache) {
      statementCache.syntaxStyle = style
    }
    queueSync()
  })

  createEffect(() => {
    props.gutterMarkers?.()
    props.isFocused()
    focusedRow()
    syncLineDecorations()
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

  rebuildStatementCache(props.initialText, buildLineStarts(props.initialText), documentVersion())

  return (
    <KeyScope
      bindings={bindings}
      enabled={props.isFocused}
    >
      <box
        ref={(node) => {
          containerRef = node
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
            autocomplete.close()
            applyScrollboxIntent()
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
            flexDirection="column"
            backgroundColor={palette().get("editor_background")}
            width="100%"
          >
            <box
              height={scrollTop()}
              minHeight={scrollTop()}
              maxHeight={scrollTop()}
            />
            <line_number
              ref={(node: LineNumberRenderable | undefined) => {
                gutterRef = node
                queueSync()
              }}
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
                  node.syntaxStyle = highlighter.highlightResult().syntaxStyle
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
                backgroundColor={palette().get("editor_background")}
                focusedBackgroundColor={palette().get("editor_background")}
                cursorColor={palette().get("editor_cursor")}
                wrapMode="char"
                selectable={true}
                keyBindings={[]}
                onMouseDown={(event: MouseEvent) => {
                  event.stopPropagation()
                  props.focusSelf()
                }}
                onMouseScroll={(event: MouseEvent) => {
                  event.stopPropagation()
                  props.focusSelf()
                  queueSync()
                }}
                onCursorChange={() => {
                  syncCursorStateFromEditor()
                }}
                onContentChange={handleContentChange}
              />
            </line_number>
            <box
              height={Math.max(0, totalRows() - scrollTop() - viewportHeight())}
              minHeight={Math.max(0, totalRows() - scrollTop() - viewportHeight())}
              maxHeight={Math.max(0, totalRows() - scrollTop() - viewportHeight())}
            />
          </box>
        </OriScrollbox>
        <SelectPopup viewModel={autocomplete.viewModel} />
      </box>
    </KeyScope>
  )
}
