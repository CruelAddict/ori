import type { BoxRenderable, KeyEvent, MouseEvent, ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import {
  computeScrollIntoViewDelta,
  hasDraggingSelectionInScrollbox,
  OriScrollbox,
  type ScrollPoint,
  scrollIntoView,
} from "@ui/components/ori-scrollbox"
import { SelectPopup } from "@ui/components/select-popup"
import type { SelectPopupAnchor } from "@ui/components/select-popup-model"
import { useLogger } from "@ui/providers/logger"
import { useTheme } from "@ui/providers/theme"
import { type KeyBinding, KeyScope } from "@ui/services/key-scopes"
import { offsetToLineCol } from "@utils/line-offsets"
import { syntaxHighlighter } from "@utils/syntax-highlighter"
import { type Accessor, createEffect, createSignal, For, onCleanup, onMount, Show, untrack } from "solid-js"
import { createBufferAutocomplete } from "./autocomplete/controller"
import type { BufferAutocompleteProvider } from "./autocomplete/types"
import { createBufferModel } from "./buffer-model"
import { type BufferCursor, type DocCharOffset, displayColumn, lineCharRange, lineIndex } from "./buffer-model/coords"
import { lineDisplayColumnToCharOffset } from "./buffer-model/text-metrics"

const DEBOUNCE_MS = 200
const DEFAULT_TAB_WIDTH = 2
const EMPTY_GUTTER_MARKERS = new Map<number, string>()

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
  const bufferModel = createBufferModel({
    initialText: props.initialText,
    tabWidth,
    isFocused: props.isFocused,
    onTextChange: props.onTextChange,
    debounceMs: DEBOUNCE_MS,
    scheduleHighlight: highlighter.scheduleHighlight,
    highlightResult: highlighter.highlightResult,
  })

  const autocomplete = createBufferAutocomplete({
    provider: () => props.autocomplete,
    isFocused: props.isFocused,
    getText: bufferModel.fullText,
    getCursorOffset: bufferModel.getCursorOffset,
    resolveAnchor: (replaceStart) => getAnchor(replaceStart),
    accept: (item, range) => {
      const start = offsetToLineCol(range.start, bufferModel.lineStarts())
      const end = offsetToLineCol(range.end, bufferModel.lineStarts())
      if (start.line !== end.line) {
        return false
      }

      return bufferModel.replaceRangeInLine(
        lineIndex(start.line),
        lineCharRange(start.col, end.col),
        item.insertText,
        "autocomplete",
        { cursorOffset: item.cursorOffset },
      )
    },
  })

  let scrollRef: ScrollBoxRenderable | undefined
  let containerRef: BoxRenderable | undefined
  const lineRenderables = new Map<string, BoxRenderable>()
  let previousCursorForFollow: BufferCursor | null = null
  let previousFocusState = props.isFocused()
  let pendingInitialContext: BufferContext | undefined
  let initialContextFlushQueued = false
  let initialContextPending = true
  let disposed = false
  const [cursorOffset, setCursorOffset] = createSignal<DocCharOffset | undefined>(bufferModel.getCursorOffset())

  const bufferMicrotask = (callback: () => void) => {
    queueMicrotask(() => {
      if (disposed) {
        return
      }
      callback()
    })
  }

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

  const gutterMarkers = () => props.gutterMarkers?.() ?? EMPTY_GUTTER_MARKERS

  createEffect(() => {
    const context = {
      text: bufferModel.fullText(),
      lineStarts: bufferModel.lineStarts(),
      focusedRow: bufferModel.focusedRow(),
      cursorOffset: cursorOffset(),
      documentVersion: bufferModel.documentVersion(),
    } satisfies BufferContext
    scheduleContextChange(context)
  })

  const getCursorPoint = (): ScrollPoint | null => {
    const cursor = bufferModel.getCursorContext()
    if (!cursor) {
      return null
    }
    const line = bufferModel.lines()[cursor.line]
    if (!line) {
      return null
    }
    const lineRenderable = lineRenderables.get(line.id)
    if (!lineRenderable) {
      return null
    }
    const ref = bufferModel.getLineRef(cursor.line)
    if (!ref) {
      return null
    }
    const visual = ref.visualCursor
    return {
      x: ref.x + visual.visualCol,
      y: lineRenderable.y + visual.visualRow,
    }
  }

  function getAnchor(replaceStart: DocCharOffset): SelectPopupAnchor | null {
    if (!containerRef) {
      return null
    }

    const cursor = offsetToLineCol(replaceStart, bufferModel.lineStarts())
    const line = bufferModel.lines()[cursor.line]
    const row = line && lineRenderables.get(line.id)
    const ref = bufferModel.getLineRef(lineIndex(cursor.line))
    if (!line || !row || !ref) {
      return null
    }

    const lineStart = bufferModel.lineStarts()[cursor.line] ?? 0
    const localOffset = replaceStart - lineStart
    const currentDisplayCol = ref.logicalCursor.col
    const currentCharIndex = lineDisplayColumnToCharOffset(bufferModel, ref.plainText, displayColumn(currentDisplayCol))
    const displayCol = Math.max(0, currentDisplayCol - (currentCharIndex - localOffset))
    const info = ref.lineInfo
    const wrapRow = info.lineStartCols.findLastIndex((startCol) => startCol <= displayCol)
    const visualRow = wrapRow >= 0 ? wrapRow : 0
    const visualCol = displayCol - (info.lineStartCols[visualRow] ?? 0)
    const nextAnchor = {
      x: Math.max(0, ref.x + visualCol - containerRef.x - 1),
      y: Math.max(0, row.y + visualRow - containerRef.y),
      containerWidth: containerRef.width,
      containerHeight: containerRef.height,
    }

    return nextAnchor
  }

  const isSameCursor = (a: BufferCursor, b: BufferCursor) => {
    return a.line === b.line && a.row === b.row && a.displayCol === b.displayCol
  }

  const scrollToCursor = (options: { allowUpward?: boolean } = {}) => {
    if (!props.isFocused()) {
      return
    }
    if (hasDraggingSelectionInScrollbox(scrollRef)) {
      return
    }
    const point = getCursorPoint()
    if (!point) {
      return
    }
    const delta = computeScrollIntoViewDelta(scrollRef, point, {
      trackX: false,
    })
    if (!delta) {
      return
    }
    if (options.allowUpward === false && delta.y < 0) {
      return
    }
    if (delta.x !== 0 || delta.y !== 0) {
      scrollRef?.scrollBy(delta)
    }
  }

  const moveCursorIntoView = () => {
    if (!props.isFocused()) {
      return
    }
    if (hasDraggingSelectionInScrollbox(scrollRef)) {
      return
    }
    const point = getCursorPoint()
    if (!point) {
      return
    }
    const delta = computeScrollIntoViewDelta(scrollRef, point, {
      trackX: false,
    })
    if (!delta || delta.y === 0) {
      return
    }
    bufferModel.moveCursorByVisualRows(-delta.y)
  }

  const focus = () => {
    bufferModel.focusCurrent()
  }

  const setText = (text: string) => {
    bufferModel.setText(text)
  }

  const getCursorOffset = () => {
    return bufferModel.getCursorOffset()
  }

  onMount(() => {
    const api: BufferApi = { setText, focus, getCursorOffset }
    props.registerApi?.(api)
  })

  onCleanup(() => {
    disposed = true
    pendingInitialContext = undefined
    autocomplete.close()
    bufferModel.dispose()
    highlighter.dispose()
  })

  const focusLineEnd = (index: number) => {
    const line = lineIndex(index)
    const eolCol = bufferModel.getVisualEOLColumn(line)
    bufferModel.setFocusedRow(line)
    bufferModel.setNavColumn(eolCol)
    bufferModel.focusCurrent()
  }

  const focusLastLineEnd = () => {
    const lastIndex = bufferModel.lines().length - 1
    if (lastIndex < 0) {
      return
    }
    focusLineEnd(lastIndex)
  }

  const handleBufferMouseDown = (event: MouseEvent) => {
    event.preventDefault()
    autocomplete.close()
    props.focusSelf()
    focusLastLineEnd()
  }

  const handleMouseDown = (index: number, event: MouseEvent) => {
    event.stopPropagation()
    autocomplete.close()
    props.focusSelf()
    event.target?.focus()
    bufferModel.setFocusedRow(lineIndex(index))
    bufferMicrotask(() => {
      const ctx = bufferModel.getCursorContext()
      if (!ctx || ctx.line !== index) {
        return
      }
      bufferModel.setNavColumn(ctx.displayCol)
    })
  }

  const handleLineMouseDown = (index: number, event: MouseEvent) => {
    event.stopPropagation()
    event.preventDefault()
    autocomplete.close()
    props.focusSelf()
    focusLineEnd(index)
  }

  const withCursor = (handler: (ctx: BufferCursor, event: KeyEvent) => void) => (event: KeyEvent) => {
    const ctx = bufferModel.getCursorContext()
    if (!ctx) {
      return
    }
    handler(ctx, event)
  }

  const bindings: KeyBinding[] = [
    {
      pattern: "escape",
      handler: () => {
        bufferModel.flush()
        props.onUnfocus?.()
      },
      preventDefault: true,
    },
    {
      pattern: "return",
      handler: withCursor((ctx, event) => {
        autocomplete.close()
        event.preventDefault()
        const point = getCursorPoint()
        if (!point) {
          return
        }
        const target = {
          x: point.x,
          y: point.y + 1,
        }
        scrollIntoView(scrollRef, target, {
          trackX: false,
        })
        bufferModel.handleEnter(ctx.line)
      }),
    },
    {
      pattern: "tab",
      handler: withCursor((ctx, event) => {
        event.preventDefault()
        const lineRef = bufferModel.getLineRef?.(ctx.line)
        if (!lineRef) {
          return
        }
        lineRef.insertText("\t")
      }),
    },
    {
      pattern: "up",
      handler: withCursor((_ctx, event) => {
        autocomplete.close()
        event.preventDefault()
        bufferModel.moveCursorByVisualRows(-1)
      }),
    },
    {
      pattern: "down",
      handler: withCursor((_ctx, event) => {
        autocomplete.close()
        event.preventDefault()
        bufferModel.moveCursorByVisualRows(1)
      }),
    },
    {
      pattern: "left",
      handler: withCursor((ctx, event) => {
        autocomplete.close()
        const atStart = ctx.displayCol === 0
        if (atStart) {
          event.preventDefault()
          bufferModel.handleHorizontalJump(ctx.line, true)
        }
      }),
    },
    {
      pattern: ["alt+left", "meta+left", "alt+b", "meta+b"],
      handler: withCursor((ctx, event) => {
        autocomplete.close()
        const atStart = ctx.displayCol === 0
        if (atStart) {
          event.preventDefault()
          bufferModel.handleHorizontalJump(ctx.line, true)
        }
      }),
    },
    {
      pattern: "right",
      handler: withCursor((ctx, event) => {
        autocomplete.close()
        const eolCol = bufferModel.getVisualEOLColumn(ctx.line)
        const atEnd = ctx.displayCol === eolCol
        if (atEnd) {
          event.preventDefault()
          bufferModel.handleHorizontalJump(ctx.line, false)
        }
      }),
    },
    {
      pattern: ["alt+right", "meta+right", "alt+f", "meta+f"],
      handler: withCursor((ctx, event) => {
        autocomplete.close()
        const eolCol = bufferModel.getVisualEOLColumn(ctx.line)
        const atEnd = ctx.displayCol === eolCol
        if (atEnd) {
          event.preventDefault()
          bufferModel.handleHorizontalJump(ctx.line, false)
        }
      }),
    },
    {
      pattern: "backspace",
      handler: withCursor((ctx, event) => {
        const atStart = ctx.displayCol === 0
        if (atStart) {
          autocomplete.close()
          event.preventDefault()
          bufferModel.handleBackwardMerge(ctx.line)
        }
      }),
    },
    {
      pattern: "delete",
      handler: withCursor((ctx, event) => {
        const eolCol = bufferModel.getVisualEOLColumn(ctx.line)
        const atEnd = ctx.displayCol === eolCol
        if (atEnd) {
          autocomplete.close()
          event.preventDefault()
          bufferModel.handleForwardMerge(ctx.line)
        }
      }),
    },
    {
      pattern: "ctrl+h",
      handler: withCursor((ctx, event) => {
        const atStart = ctx.displayCol === 0
        if (atStart) {
          autocomplete.close()
          event.preventDefault()
          bufferModel.handleBackwardMerge(ctx.line)
        }
      }),
    },
    {
      pattern: "ctrl+w",
      handler: withCursor((ctx, event) => {
        const atStart = ctx.displayCol === 0
        if (atStart) {
          autocomplete.close()
          event.preventDefault()
          bufferModel.handleBackwardMerge(ctx.line)
        }
      }),
    },
    {
      pattern: "ctrl+d",
      handler: withCursor((ctx, event) => {
        const eolCol = bufferModel.getVisualEOLColumn(ctx.line)
        const atEnd = ctx.displayCol === eolCol
        if (atEnd) {
          autocomplete.close()
          event.preventDefault()
          bufferModel.handleForwardMerge(ctx.line)
        }
      }),
    },
  ]

  createEffect(() => {
    const isFocused = props.isFocused()
    if (isFocused === previousFocusState) {
      return
    }
    previousFocusState = isFocused
    bufferModel.handleFocusChange(isFocused)
    if (!isFocused) {
      previousCursorForFollow = null
      autocomplete.close()
      return
    }
    bufferMicrotask(() => {
      scrollToCursor()
    })
  })

  createEffect(() => {
    if (!props.isFocused()) {
      return
    }
    bufferModel.focusedRow()
    bufferModel.navColumn()
    const next = bufferModel.getCursorContext()
    const prev = previousCursorForFollow
    previousCursorForFollow = next ?? null
    if (prev && next && isSameCursor(prev, next)) {
      return
    }
    const movedDown = !!next && !!prev && (next.line > prev.line || (next.line === prev.line && next.row > prev.row))
    const expectedCursor = next
    bufferMicrotask(() => {
      const currentCursor = bufferModel.getCursorContext()
      if (!expectedCursor || !currentCursor || !isSameCursor(expectedCursor, currentCursor)) {
        return
      }
      scrollToCursor({
        allowUpward: !movedDown,
      })
    })
  })

  const lineBg = (row: number) => {
    return props.isFocused() && bufferModel.focusedRow() === row
      ? palette().get("editor_active_line_background")
      : undefined
  }

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
      >
        <OriScrollbox
          marginTop={1}
          stickyScroll={true}
          onReady={(node) => {
            scrollRef = node
            if (!node || !props.isFocused()) {
              return
            }
            bufferMicrotask(() => {
              scrollToCursor()
            })
          }}
          onSync={() =>
            bufferMicrotask(() => {
              scrollToCursor()
            })
          }
          onUserScroll={() => {
            autocomplete.close()
            moveCursorIntoView()
          }}
          height={"100%"}
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
            flexGrow={1}
          >
            <box
              flexDirection="column"
              flexGrow={1}
              onMouseDown={handleBufferMouseDown}
            >
              <For each={bufferModel.lineIds()}>
                {(lineId, indexAccessor) => {
                  const line = () => bufferModel.linesById().get(lineId)
                  const initialText = untrack(line)?.text
                  return (
                    <box
                      ref={(node) => {
                        if (!node) {
                          lineRenderables.delete(lineId)
                          return
                        }
                        lineRenderables.set(lineId, node)
                      }}
                      flexDirection="row"
                      width="100%"
                      backgroundColor={lineBg(indexAccessor())}
                    >
                      <box
                        flexDirection="row"
                        minWidth={5}
                        justifyContent="flex-end"
                        alignItems="flex-start"
                        paddingRight={1}
                        onMouseDown={(event: MouseEvent) => handleLineMouseDown(indexAccessor(), event)}
                        backgroundColor={lineBg(indexAccessor())}
                      >
                        <text
                          maxHeight={1}
                          fg={palette().get("text_muted")}
                          bg={lineBg(indexAccessor())}
                        >
                          {gutterMarkers().get(indexAccessor()) ?? ""}
                        </text>
                        <text
                          maxHeight={1}
                          fg={palette().get("text_muted")}
                          bg={lineBg(indexAccessor())}
                        >
                          {indexAccessor() + 1}
                        </text>
                      </box>
                      <textarea
                        flexGrow={1}
                        backgroundColor={lineBg(indexAccessor())}
                        focusedBackgroundColor={lineBg(indexAccessor())}
                        ref={(renderable: TextareaRenderable | undefined) => {
                          const lineValue = untrack(line)
                          if (!lineValue) {
                            return
                          }
                          bufferModel.setLineRef(lineValue.id, renderable)
                        }}
                        textColor={palette().get("editor_text")}
                        focusedTextColor={palette().get("editor_text")}
                        cursorColor={palette().get("editor_cursor")}
                        syntaxStyle={highlighter.highlightResult().syntaxStyle}
                        wrapMode="char"
                        selectable={true}
                        keyBindings={[]}
                        onMouseDown={(event: MouseEvent) => {
                          handleMouseDown(indexAccessor(), event)
                        }}
                        onCursorChange={() => {
                          const idx = lineIndex(indexAccessor())
                          const ref = bufferModel.getLineRef(idx)
                          if (!ref) {
                            return
                          }
                          bufferModel.setNavColumn(displayColumn(ref.logicalCursor.col))
                          setCursorOffset(bufferModel.getCursorOffset())
                        }}
                        initialValue={initialText}
                        onContentChange={() => {
                          const origin = bufferModel.handleTextAreaChange(lineIndex(indexAccessor())) ?? "user"
                          if (origin === "user") {
                            bufferMicrotask(() => {
                              autocomplete.refresh()
                            })
                          }
                        }}
                      />
                    </box>
                  )
                }}
              </For>
              <Show when={bufferModel.lines().length === 0}>
                <text fg={palette().get("editor_text")}> </text>
              </Show>
            </box>
          </box>
        </OriScrollbox>
        <SelectPopup viewModel={autocomplete.viewModel} />
      </box>
    </KeyScope>
  )
}
