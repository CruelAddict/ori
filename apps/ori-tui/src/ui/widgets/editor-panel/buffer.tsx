import type { BoxRenderable, KeyEvent, MouseEvent, ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import { type FollowOutOfBandContext, type FollowRect, OriScrollbox } from "@ui/components/ori-scrollbox"
import { useLogger } from "@ui/providers/logger"
import { useTheme } from "@ui/providers/theme"
import { type KeyBinding, KeyScope } from "@ui/services/key-scopes"
import { cursorScrolloffY } from "@ui/services/scroll-follow-settings"
import { syntaxHighlighter } from "@utils/syntax-highlighter"
import { type Accessor, createEffect, createSignal, For, on, onCleanup, onMount, Show, untrack } from "solid-js"
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
  const [lineVersion, setLineVersion] = createSignal(0)

  const getViewport = () => {
    const viewport = (scrollRef as ScrollBoxRenderable & { viewport?: { y?: number; height?: number } })?.viewport
    if (!viewport) {
      return undefined
    }
    if (viewport.y === undefined || viewport.height === undefined) {
      return undefined
    }
    if (!Number.isFinite(viewport.y) || !Number.isFinite(viewport.height)) {
      return undefined
    }
    if (viewport.height <= 0) {
      return undefined
    }
    return {
      y: viewport.y,
      height: viewport.height,
    }
  }

  const getLineRect = (index: number): FollowRect | undefined => {
    const line = bufferModel.lines()[index]
    if (!line) {
      return undefined
    }
    const renderable = lineRenderables.get(line.id)
    if (!renderable) {
      return undefined
    }
    if (renderable.x === undefined || renderable.y === undefined) {
      return undefined
    }
    if (renderable.width === undefined || renderable.height === undefined) {
      return undefined
    }
    if (!Number.isFinite(renderable.x) || !Number.isFinite(renderable.y)) {
      return undefined
    }
    if (!Number.isFinite(renderable.width) || !Number.isFinite(renderable.height)) {
      return undefined
    }
    if (renderable.width <= 0 || renderable.height <= 0) {
      return undefined
    }
    return {
      x: renderable.x,
      y: renderable.y,
      width: renderable.width,
      height: renderable.height,
    }
  }

  const followTarget = (): FollowRect | null => {
    if (!props.isFocused()) {
      return null
    }
    lineVersion()
    return getLineRect(bufferModel.focusedRow()) ?? null
  }

  const prepareScrollBeforeEnter = (index: number) => {
    const lineRect = getLineRect(index)
    const viewport = getViewport()
    if (!lineRect || !viewport) {
      return
    }
    const inset = Math.min(cursorScrolloffY, Math.max(0, Math.floor((viewport.height - 1) / 2)))
    const bandBottom = viewport.y + viewport.height - inset
    const predictedNextBottom = lineRect.y + lineRect.height + 1
    if (predictedNextBottom <= bandBottom) {
      return
    }
    scrollRef?.scrollBy({ x: 0, y: predictedNextBottom - bandBottom })
  }

  const setCursorRowAndKeepColumn = (index: number) => {
    const nav = bufferModel.navColumn()
    bufferModel.setFocusedRow(index)
    bufferModel.setNavColumn(nav)
    bufferModel.focusCurrent()
  }

  const findFirstLineAtOrBelow = (threshold: number): number | undefined => {
    const lines = bufferModel.lines()
    for (let i = 0; i < lines.length; i += 1) {
      const rect = getLineRect(i)
      if (!rect) {
        continue
      }
      if (rect.y + rect.height > threshold) {
        return i
      }
    }
    return undefined
  }

  const findLastLineAtOrAbove = (threshold: number): number | undefined => {
    const lines = bufferModel.lines()
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const rect = getLineRect(i)
      if (!rect) {
        continue
      }
      if (rect.y < threshold) {
        return i
      }
    }
    return undefined
  }

  const moveCursorWithinBand = (context: FollowOutOfBandContext) => {
    if (!props.isFocused()) {
      return "autoscroll" as const
    }
    const cursor = bufferModel.getCursorContext()
    if (!cursor) {
      return "autoscroll" as const
    }
    const current = context.target

    if (current.y < context.band.top) {
      const target = findFirstLineAtOrBelow(context.band.top)
      if (target === undefined) {
        return "handled" as const
      }
      setCursorRowAndKeepColumn(target)
      return "handled" as const
    }

    if (current.y + current.height > context.band.bottom) {
      const target = findLastLineAtOrAbove(context.band.bottom)
      if (target === undefined) {
        return "handled" as const
      }
      setCursorRowAndKeepColumn(target)
      return "handled" as const
    }

    return "handled" as const
  }

  const handleFollowOutOfBand = (context: FollowOutOfBandContext) => {
    if (context.source !== "manual-scroll") {
      return "autoscroll" as const
    }
    return moveCursorWithinBand(context)
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
        prepareScrollBeforeEnter(ctx.index)
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
      <OriScrollbox
        marginTop={1}
        onReady={(node) => {
          scrollRef = node
        }}
        follow={{
          target: followTarget,
          scrolloff: { x: 0, y: cursorScrolloffY },
          sources: {
            targetChange: true,
            viewportResize: true,
            manualScroll: true,
          },
          onOutOfBand: handleFollowOutOfBand,
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
                    ref={(ref: BoxRenderable | undefined) => {
                      if (!ref) {
                        lineRenderables.delete(lineId)
                        setLineVersion((value) => value + 1)
                        return
                      }
                      lineRenderables.set(lineId, ref)
                      setLineVersion((value) => value + 1)
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
