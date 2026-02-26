import type { BoxRenderable, KeyEvent, MouseEvent, ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import { OriScrollbox, resolveScrollIntoView, type ScrollPoint, scrollIntoView } from "@ui/components/ori-scrollbox"
import { useLogger } from "@ui/providers/logger"
import { useTheme } from "@ui/providers/theme"
import { type KeyBinding, KeyScope } from "@ui/services/key-scopes"
import { cursorScrolloffY } from "@ui/services/scroll-follow-settings"
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
  const rowAnchors = new Map<string, BoxRenderable>()
  let viewportSize: { width: number; height: number } | null = null
  let skipCursorChangeScroll = false

  const getViewport = () => {
    const viewport = (
      scrollRef as ScrollBoxRenderable & { viewport?: { x?: number; y?: number; width?: number; height?: number } }
    )?.viewport
    if (!viewport) {
      return undefined
    }
    if (
      viewport.x === undefined ||
      viewport.y === undefined ||
      viewport.width === undefined ||
      viewport.height === undefined
    ) {
      return undefined
    }
    if (
      !Number.isFinite(viewport.x) ||
      !Number.isFinite(viewport.y) ||
      !Number.isFinite(viewport.width) ||
      !Number.isFinite(viewport.height)
    ) {
      return undefined
    }
    if (viewport.width <= 0 || viewport.height <= 0) {
      return undefined
    }
    return {
      x: viewport.x,
      y: viewport.y,
      width: viewport.width,
      height: viewport.height,
    }
  }

  const toFinite = (value: number | undefined): number | undefined => {
    if (value === undefined) {
      return undefined
    }
    if (!Number.isFinite(value)) {
      return undefined
    }
    return value
  }

  const getCursorPoint = (): ScrollPoint | null => {
    const cursor = bufferModel.getCursorContext()
    if (!cursor) {
      return null
    }
    const line = bufferModel.lines()[cursor.index]
    if (!line) {
      return null
    }
    const anchor = rowAnchors.get(line.id)
    if (!anchor) {
      return null
    }
    const ref = bufferModel.getLineRef(cursor.index)
    if (!ref) {
      return null
    }
    const x = toFinite(ref.x)
    const anchorY = toFinite(anchor.y)
    const visual = ref.visualCursor
    const visualCol = toFinite(visual?.visualCol)
    const visualRow = toFinite(visual?.visualRow)
    if (x === undefined || anchorY === undefined || visualCol === undefined || visualRow === undefined) {
      return null
    }
    return {
      x: Math.floor(x + visualCol),
      y: Math.floor(anchorY + visualRow),
    }
  }

  const followTarget = (): ScrollPoint | null => {
    if (!props.isFocused()) {
      return null
    }
    return getCursorPoint()
  }

  const moveCursorByVisualRows = (delta: number): number => {
    if (delta === 0) {
      return 0
    }
    const direction = delta > 0 ? 1 : -1
    const steps = Math.abs(delta)
    let moved = 0
    for (let i = 0; i < steps; i += 1) {
      const before = bufferModel.getCursorContext()
      if (!before) {
        break
      }
      const ref = bufferModel.getLineRef(before.index)
      if (!ref) {
        break
      }
      const movedInsideLine = direction > 0 ? ref.moveCursorDown() : ref.moveCursorUp()
      const afterInsideMove = bufferModel.getCursorContext()
      const movedInsideLineForReal =
        movedInsideLine &&
        !!afterInsideMove &&
        (afterInsideMove.index !== before.index ||
          afterInsideMove.cursorRow !== before.cursorRow ||
          afterInsideMove.cursorCol !== before.cursorCol)
      if (movedInsideLineForReal && afterInsideMove) {
        bufferModel.setNavColumn(afterInsideMove.cursorCol)
        moved += 1
        continue
      }
      const nextIndex = before.index + direction
      const nextLine = bufferModel.lines()[nextIndex]
      if (!nextLine) {
        break
      }
      const targetCol = Math.min(bufferModel.navColumn(), bufferModel.getVisualEOLColumn(nextIndex))
      bufferModel.setFocusedRow(nextIndex)
      bufferModel.setNavColumn(targetCol)
      bufferModel.focusCurrent()
      moved += 1
    }
    return moved
  }

  const requestCursorScroll = (_reason: string) => {
    if (!props.isFocused()) {
      return
    }
    const point = followTarget()
    if (!point) {
      return
    }
    scrollIntoView(scrollRef, point, {
      scrolloffY: cursorScrolloffY,
      trackX: false,
    })
  }

  const handleScrollboxSync = () => {
    const viewport = getViewport()
    if (!viewport) {
      viewportSize = null
      return
    }
    if (viewportSize && viewportSize.width === viewport.width && viewportSize.height === viewport.height) {
      return
    }
    viewportSize = {
      width: viewport.width,
      height: viewport.height,
    }
    queueMicrotask(() => {
      requestCursorScroll("viewport-resize")
    })
  }

  const handleUserScroll = () => {
    if (!props.isFocused()) {
      return
    }
    const point = followTarget()
    if (!point) {
      return
    }
    const plan = resolveScrollIntoView(scrollRef, point, {
      scrolloffY: cursorScrolloffY,
      trackX: false,
    })
    if (!plan) {
      return
    }
    if (plan.delta.y === 0) {
      return
    }
    const moved = moveCursorByVisualRows(-plan.delta.y)
    if (moved >= Math.abs(plan.delta.y)) {
      return
    }
    queueMicrotask(() => {
      requestCursorScroll("manual-scroll-shortfall")
    })
  }

  const prepareScrollBeforeEnter = () => {
    if (!props.isFocused()) {
      return
    }
    const point = getCursorPoint()
    if (!point) {
      return
    }
    const target = {
      x: point.x,
      y: point.y + 1,
    }
    scrollIntoView(scrollRef, target, {
      scrolloffY: cursorScrolloffY,
      trackX: false,
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
        skipCursorChangeScroll = true
        prepareScrollBeforeEnter()
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
        return
      }
      queueMicrotask(() => {
        requestCursorScroll("focus")
      })
    }),
  )

  createEffect(() => {
    if (!props.isFocused()) {
      return
    }
    bufferModel.focusedRow()
    bufferModel.navColumn()
    if (skipCursorChangeScroll) {
      skipCursorChangeScroll = false
      return
    }
    queueMicrotask(() => {
      requestCursorScroll("cursor-change")
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
          const viewport = getViewport()
          viewportSize = viewport
            ? {
                width: viewport.width,
                height: viewport.height,
              }
            : null
          if (!node || !props.isFocused()) {
            return
          }
          queueMicrotask(() => {
            requestCursorScroll("ready")
          })
        }}
        onSync={handleScrollboxSync}
        onUserScroll={handleUserScroll}
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
                        rowAnchors.delete(lineId)
                        return
                      }
                      rowAnchors.set(lineId, node)
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
