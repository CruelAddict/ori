import { useLogger } from "@app/providers/logger"
import { useTheme } from "@app/providers/theme"
import type { BoxRenderable, KeyEvent, MouseEvent, ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import { syntaxHighlighter } from "@shared/lib/syntax-highlighting/syntax-highlighter"
import { type KeyBinding, KeyScope } from "@src/core/services/key-scopes"
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

  const getViewport = () => (scrollRef as ScrollBoxRenderable & { viewport?: BoxRenderable })?.viewport

  const autoScrollIfAtEdge = (ctx: CursorContext, direction: -1 | 1) => {
    const targetIndex = ctx.index + direction
    if (!bufferModel.lines()[targetIndex]) {
      return
    }
    const line = bufferModel.lines()[ctx.index]
    if (!line) {
      return
    }
    const renderable = lineRenderables.get(line.id)
    const viewport = getViewport()
    if (!renderable || !viewport) {
      return
    }
    const lineTop = renderable.y ?? 0
    const lineBottom = lineTop + (renderable.height ?? 0)
    const viewportTop = viewport.y ?? 0
    const viewportBottom = viewportTop + (viewport.height ?? 0)

    if (direction === 1 && lineBottom >= viewportBottom) {
      scrollRef?.scrollBy({ x: 0, y: renderable.height ?? 1 })
    } else if (direction === -1 && lineTop <= viewportTop) {
      scrollRef?.scrollBy({ x: 0, y: -(renderable.height ?? 1) })
    }
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
        autoScrollIfAtEdge(ctx, -1)
        bufferModel.handleVerticalMove(ctx.index, -1)
      }),
    },
    {
      pattern: "down",
      handler: withCursor((ctx, event) => {
        event.preventDefault()
        autoScrollIfAtEdge(ctx, 1)
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
          autoScrollIfAtEdge(ctx, -1)
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
          autoScrollIfAtEdge(ctx, -1)
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
          autoScrollIfAtEdge(ctx, -1)
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
    }),
  )

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
      <scrollbox
        ref={(node: ScrollBoxRenderable | undefined) => {
          scrollRef = node ?? undefined
        }}
        height={"100%"}
        stickyScroll={true}
        stickyStart="bottom"
      >
        <box
          flexDirection="column"
          backgroundColor={palette().get("editor_background")}
          flexGrow={1}
        >
          <box
            marginTop={1}
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
                    ref={(ref: BoxRenderable | undefined) => {
                      if (!ref) {
                        lineRenderables.delete(lineId)
                        return
                      }
                      lineRenderables.set(lineId, ref)
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
      </scrollbox>
    </KeyScope>
  )
}
