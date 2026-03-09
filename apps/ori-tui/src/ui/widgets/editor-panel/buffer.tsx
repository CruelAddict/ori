import type { BoxRenderable, KeyEvent, MouseEvent, ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import {
  computeScrollIntoViewDelta,
  OriScrollbox,
  type ScrollPoint,
  scrollIntoView,
} from "@ui/components/ori-scrollbox"
import { useLogger } from "@ui/providers/logger"
import { useTheme } from "@ui/providers/theme"
import { type KeyBinding, KeyScope } from "@ui/services/key-scopes"
import { syntaxHighlighter } from "@utils/syntax-highlighter"
import { type Accessor, createEffect, For, on, onCleanup, onMount, Show, untrack } from "solid-js"
import { type CursorContext, createBufferModel } from "./buffer-model"

const DEBOUNCE_MS = 200
export type BufferApi = {
  setText: (text: string) => void
  focus: () => void
}

export type BufferProps = {
  initialText: string
  isFocused: Accessor<boolean>
  onTextChange: (text: string, info: { modified: boolean }) => void
  onUnfocus?: () => void
  registerApi?: (api: BufferApi) => void
  focusSelf: () => void
}

export function Buffer(props: BufferProps) {
  const { theme } = useTheme()
  const palette = theme
  const logger = useLogger()

  const highlighter = syntaxHighlighter({
    theme: palette,
    language: "sql",
    logger,
  })

  const bufferModel = createBufferModel({
    initialText: props.initialText,
    isFocused: props.isFocused,
    onTextChange: props.onTextChange,
    debounceMs: DEBOUNCE_MS,
    scheduleHighlight: highlighter.scheduleHighlight,
    highlightResult: highlighter.highlightResult,
    logger,
  })

  let scrollRef: ScrollBoxRenderable | undefined
  const lineRenderables = new Map<string, BoxRenderable>()
  let previousCursorForFollow: CursorContext | null = null

  const getCursorPoint = (): ScrollPoint | null => {
    const cursor = bufferModel.getCursorContext()
    if (!cursor) {
      return null
    }
    const line = bufferModel.lines()[cursor.index]
    if (!line) {
      return null
    }
    const lineRenderable = lineRenderables.get(line.id)
    if (!lineRenderable) {
      return null
    }
    const ref = bufferModel.getLineRef(cursor.index)
    if (!ref) {
      return null
    }
    const visual = ref.visualCursor
    return {
      x: ref.x + visual.visualCol,
      y: lineRenderable.y + visual.visualRow,
    }
  }

  const isSameCursor = (a: CursorContext, b: CursorContext) => {
    return a.index === b.index && a.cursorRow === b.cursorRow && a.cursorCol === b.cursorCol
  }

  const scrollToCursor = (options: { allowUpward?: boolean } = {}) => {
    if (!props.isFocused()) {
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
    if (delta.y === 0) {
      return
    }
    const moved = bufferModel.moveCursorByVisualRows(-delta.y)
    if (moved >= Math.abs(delta.y)) {
      return
    }
    queueMicrotask(() => {
      scrollToCursor()
    })
  }

  const focus = () => {
    bufferModel.focusCurrent()
  }

  const setText = (text: string) => {
    bufferModel.setText(text)
  }

  onMount(() => {
    const api: BufferApi = { setText, focus }
    props.registerApi?.(api)
  })

  onCleanup(() => {
    bufferModel.dispose()
    highlighter.dispose()
  })

  const focusLineEnd = (index: number) => {
    const eolCol = bufferModel.getVisualEOLColumn(index)
    bufferModel.setFocusedRow(index)
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
    props.focusSelf()
    focusLastLineEnd()
  }

  const handleMouseDown = (index: number, event: MouseEvent) => {
    event.stopPropagation()
    props.focusSelf()
    event.target?.focus()
    bufferModel.setFocusedRow(index)
    queueMicrotask(() => {
      const ctx = bufferModel.getCursorContext()
      if (!ctx || ctx.index !== index) {
        return
      }
      bufferModel.setNavColumn(ctx.cursorCol)
    })
  }

  const handleLineMouseDown = (index: number, event: MouseEvent) => {
    event.stopPropagation()
    event.preventDefault()
    props.focusSelf()
    focusLineEnd(index)
  }

  const withCursor = (handler: (ctx: CursorContext, event: KeyEvent) => void) => (event: KeyEvent) => {
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
        bufferModel.handleEnter(ctx.index)
      }),
    },
    {
      pattern: "tab",
      handler: withCursor((ctx, event) => {
        event.preventDefault()
        const lineRef = bufferModel.getLineRef?.(ctx.index)
        if (!lineRef) {
          return
        }
        lineRef.insertText("\t")
      }),
    },
    {
      pattern: "up",
      handler: withCursor((ctx, event) => {
        event.preventDefault()
        bufferModel.handleVerticalMove(ctx.index, -1)
      }),
    },
    {
      pattern: "down",
      handler: withCursor((ctx, event) => {
        event.preventDefault()
        bufferModel.handleVerticalMove(ctx.index, 1)
      }),
    },
    {
      pattern: "left",
      handler: withCursor((ctx, event) => {
        const atStart = ctx.cursorCol === 0 && ctx.cursorRow === 0
        if (atStart) {
          event.preventDefault()
          bufferModel.handleHorizontalJump(ctx.index, true)
        }
      }),
    },
    {
      pattern: ["alt+left", "meta+left", "alt+b", "meta+b"],
      handler: withCursor((ctx, event) => {
        const atStart = ctx.cursorCol === 0 && ctx.cursorRow === 0
        if (atStart) {
          event.preventDefault()
          bufferModel.handleHorizontalJump(ctx.index, true)
        }
      }),
    },
    {
      pattern: "right",
      handler: withCursor((ctx, event) => {
        const eolCol = bufferModel.getVisualEOLColumn(ctx.index)
        const atEnd = ctx.cursorCol === eolCol && ctx.cursorRow === 0
        if (atEnd) {
          event.preventDefault()
          bufferModel.handleHorizontalJump(ctx.index, false)
        }
      }),
    },
    {
      pattern: ["alt+right", "meta+right", "alt+f", "meta+f"],
      handler: withCursor((ctx, event) => {
        const eolCol = bufferModel.getVisualEOLColumn(ctx.index)
        const atEnd = ctx.cursorCol === eolCol && ctx.cursorRow === 0
        if (atEnd) {
          event.preventDefault()
          bufferModel.handleHorizontalJump(ctx.index, false)
        }
      }),
    },
    {
      pattern: "backspace",
      handler: withCursor((ctx, event) => {
        const atStart = ctx.cursorCol === 0 && ctx.cursorRow === 0
        if (atStart) {
          event.preventDefault()
          bufferModel.handleBackwardMerge(ctx.index)
        }
      }),
    },
    {
      pattern: "delete",
      handler: withCursor((ctx, event) => {
        const eolCol = bufferModel.getVisualEOLColumn(ctx.index)
        const atEnd = ctx.cursorCol === eolCol && ctx.cursorRow === 0
        if (atEnd) {
          event.preventDefault()
          bufferModel.handleForwardMerge(ctx.index)
        }
      }),
    },
    {
      pattern: "ctrl+h",
      handler: withCursor((ctx, event) => {
        const atStart = ctx.cursorCol === 0 && ctx.cursorRow === 0
        if (atStart) {
          event.preventDefault()
          bufferModel.handleBackwardMerge(ctx.index)
        }
      }),
    },
    {
      pattern: "ctrl+w",
      handler: withCursor((ctx, event) => {
        const atStart = ctx.cursorCol === 0 && ctx.cursorRow === 0
        if (atStart) {
          event.preventDefault()
          bufferModel.handleBackwardMerge(ctx.index)
        }
      }),
    },
    {
      pattern: "ctrl+d",
      handler: withCursor((ctx, event) => {
        const eolCol = bufferModel.getVisualEOLColumn(ctx.index)
        const atEnd = ctx.cursorCol === eolCol && ctx.cursorRow === 0
        if (atEnd) {
          event.preventDefault()
          bufferModel.handleForwardMerge(ctx.index)
        }
      }),
    },
  ]

  createEffect(
    on(props.isFocused, (isFocused) => {
      bufferModel.handleFocusChange(isFocused)
      if (!isFocused) {
        previousCursorForFollow = null
        return
      }
      queueMicrotask(() => {
        scrollToCursor()
      })
    }),
  )

  createEffect(() => {
    if (!props.isFocused()) {
      return
    }
    // Re-run follow logic when the focused cursor target changes
    bufferModel.focusedRow()
    bufferModel.navColumn()
    const next = bufferModel.getCursorContext()
    const prev = previousCursorForFollow
    previousCursorForFollow = next ?? null
    // Ignore no-op cursor updates emitted during Enter split/focus churn
    if (prev && next && isSameCursor(prev, next)) {
      return
    }
    const movedDown =
      !!next && !!prev && (next.index > prev.index || (next.index === prev.index && next.cursorRow > prev.cursorRow))
    const expectedCursor = next
    queueMicrotask(() => {
      const currentCursor = bufferModel.getCursorContext()
      // Drop stale queued follow if cursor changed again before this microtask ran
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
      <OriScrollbox
        marginTop={1}
        stickyScroll={true}
        onReady={(node) => {
          scrollRef = node
          if (!node || !props.isFocused()) {
            return
          }
          queueMicrotask(() => {
            scrollToCursor()
          })
        }}
        onSync={() => queueMicrotask(() => scrollToCursor())}
        onUserScroll={moveCursorIntoView}
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
                  // Wrapper for the whole line
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
                    {/* Line info (number, indicators) */}
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
                        {(() => {
                          if (bufferModel.statements().length < 2) {
                            return ""
                          }
                          const target = bufferModel.statementAtCursor()
                          if (target?.startLine === indexAccessor()) {
                            return "󰻃 "
                          }
                          const hasStart = bufferModel
                            .statements()
                            .some((statement) => statement.startLine === indexAccessor())
                          return hasStart ? "• " : ""
                        })()}
                      </text>
                      <text
                        maxHeight={1}
                        fg={palette().get("text_muted")}
                        bg={lineBg(indexAccessor())}
                      >
                        {indexAccessor() + 1}
                      </text>
                    </box>
                    {/* Per-line input field */}
                    <textarea
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
                      selectable={true}
                      keyBindings={[]}
                      onMouseDown={(event: MouseEvent) => {
                        handleMouseDown(indexAccessor(), event)
                      }}
                      onCursorChange={() => {
                        const idx = indexAccessor()
                        const ref = bufferModel.getLineRef(idx)
                        if (!ref) {
                          return
                        }
                        bufferModel.setNavColumn(ref.logicalCursor.col)
                      }}
                      initialValue={initialText}
                      onContentChange={() => bufferModel.handleTextAreaChange(indexAccessor())}
                    />
                    {/* Fills the rest of the line to handle mouse clicks */}
                    <box
                      flexGrow={1}
                      backgroundColor={lineBg(indexAccessor())}
                      onMouseDown={(event: MouseEvent) => handleLineMouseDown(indexAccessor(), event)}
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
    </KeyScope>
  )
}
