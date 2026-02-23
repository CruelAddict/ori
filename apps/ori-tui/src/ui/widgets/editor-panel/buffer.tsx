import type { BoxRenderable, KeyEvent, MouseEvent, ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import { type FollowOutOfBandContext, type FollowPoint, OriScrollbox } from "@ui/components/ori-scrollbox"
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

  const logFollow = (event: string, payload: Record<string, unknown>) => {
    logger.debug(payload, `editor-follow:${event}`)
  }

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
  const [anchorVersion, setAnchorVersion] = createSignal(0)
  let pendingEnterFollow = false
  let lastStableFollowPoint: FollowPoint | null = null

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

  const toFinite = (value: number | undefined): number | undefined => {
    if (value === undefined) {
      return undefined
    }
    if (!Number.isFinite(value)) {
      return undefined
    }
    return value
  }

  const getCursorPoint = (): FollowPoint | null => {
    anchorVersion()
    const cursor = bufferModel.getCursorContext()
    if (!cursor) {
      logFollow("cursor-point-null", {
        reason: "missing-cursor-context",
        focused: props.isFocused(),
        focusedRow: bufferModel.focusedRow(),
      })
      return null
    }
    const line = bufferModel.lines()[cursor.index]
    if (!line) {
      logFollow("cursor-point-null", {
        reason: "missing-line",
        cursor,
      })
      return null
    }
    const anchor = rowAnchors.get(line.id)
    if (!anchor) {
      logFollow("cursor-point-null", {
        reason: "missing-anchor",
        lineId: line.id,
        cursor,
      })
      return null
    }
    const ref = bufferModel.getLineRef(cursor.index)
    if (!ref) {
      logFollow("cursor-point-null", {
        reason: "missing-line-ref",
        lineId: line.id,
        cursor,
      })
      return null
    }
    const x = toFinite(ref.x)
    const anchorY = toFinite(anchor.y)
    const visual = ref.visualCursor
    const visualCol = toFinite(visual?.visualCol)
    const visualRow = toFinite(visual?.visualRow)
    if (x === undefined || anchorY === undefined || visualCol === undefined || visualRow === undefined) {
      logFollow("cursor-point-null", {
        reason: "invalid-coordinates",
        lineId: line.id,
        cursor,
        refX: ref.x,
        refY: ref.y,
        anchorY: anchor.y,
        visualCol: visual?.visualCol,
        visualRow: visual?.visualRow,
      })
      return null
    }
    const point = {
      x: Math.floor(x + visualCol),
      y: Math.floor(anchorY + visualRow),
    }
    logFollow("cursor-point", {
      lineId: line.id,
      focusedRow: bufferModel.focusedRow(),
      cursor,
      refX: ref.x,
      refY: ref.y,
      anchorY: anchor.y,
      visualCol,
      visualRow,
      point,
      scrollTop: scrollRef?.scrollTop ?? 0,
      viewportY: getViewport()?.y,
      viewportHeight: getViewport()?.height,
    })
    return point
  }

  const followTarget = (): FollowPoint | null => {
    if (!props.isFocused()) {
      pendingEnterFollow = false
      logFollow("follow-target", {
        focused: false,
        reason: "buffer-unfocused",
      })
      return null
    }
    const point = getCursorPoint()
    const viewport = getViewport()
    if (point && (!viewport || point.y >= viewport.y)) {
      lastStableFollowPoint = point
      if (pendingEnterFollow) {
        pendingEnterFollow = false
        logFollow("enter-follow-stable", {
          point,
          viewport,
        })
      }
      logFollow("follow-target", {
        focused: true,
        point,
      })
      return point
    }
    if (pendingEnterFollow) {
      logFollow("enter-follow-guard", {
        point,
        viewport,
        fallback: lastStableFollowPoint,
      })
      logFollow("follow-target", {
        focused: true,
        point: lastStableFollowPoint,
      })
      return lastStableFollowPoint
    }
    if (point) {
      lastStableFollowPoint = point
    }
    logFollow("follow-target", {
      focused: true,
      point,
    })
    return point
  }

  const prepareScrollBeforeEnter = () => {
    const point = getCursorPoint()
    const viewport = getViewport()
    if (!point || !viewport) {
      logFollow("prepare-enter-skip", {
        point,
        viewport,
      })
      return
    }
    const inset = Math.min(cursorScrolloffY, Math.max(0, Math.floor((viewport.height - 1) / 2)))
    const bandBottom = viewport.y + viewport.height - inset
    const predictedNextRow = point.y + 1
    if (predictedNextRow <= bandBottom) {
      logFollow("prepare-enter-no-scroll", {
        point,
        viewport,
        inset,
        bandBottom,
        predictedNextRow,
      })
      return
    }
    const delta = predictedNextRow - bandBottom
    logFollow("prepare-enter-scroll", {
      point,
      viewport,
      inset,
      bandBottom,
      predictedNextRow,
      delta,
      beforeScrollTop: scrollRef?.scrollTop ?? 0,
    })
    scrollRef?.scrollBy({ x: 0, y: delta })
    logFollow("prepare-enter-scroll-done", {
      afterScrollTop: scrollRef?.scrollTop ?? 0,
    })
  }

  const moveCursorByVisualRows = (delta: number): number => {
    if (delta === 0) {
      logFollow("cursor-move-skip", {
        reason: "zero-delta",
      })
      return 0
    }
    const direction = delta > 0 ? 1 : -1
    const steps = Math.abs(delta)
    let moved = 0
    logFollow("cursor-move-start", {
      delta,
      direction,
      steps,
      focusedRow: bufferModel.focusedRow(),
      navColumn: bufferModel.navColumn(),
    })
    for (let i = 0; i < steps; i += 1) {
      const before = bufferModel.getCursorContext()
      if (!before) {
        logFollow("cursor-move-break", {
          reason: "missing-cursor-context",
          step: i,
          moved,
        })
        break
      }
      const ref = bufferModel.getLineRef(before.index)
      if (!ref) {
        logFollow("cursor-move-break", {
          reason: "missing-line-ref",
          step: i,
          moved,
          before,
        })
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
        logFollow("cursor-move-step", {
          step: i,
          path: "inside-line",
          before,
          after: afterInsideMove,
          moved,
        })
        continue
      }
      if (movedInsideLine) {
        logFollow("cursor-move-inside-line-noop", {
          step: i,
          before,
          afterInsideMove,
          direction,
        })
      }
      const nextIndex = before.index + direction
      const nextLine = bufferModel.lines()[nextIndex]
      if (!nextLine) {
        logFollow("cursor-move-break", {
          reason: "line-boundary",
          step: i,
          moved,
          before,
          direction,
        })
        break
      }
      const targetCol = Math.min(bufferModel.navColumn(), bufferModel.getVisualEOLColumn(nextIndex))
      bufferModel.setFocusedRow(nextIndex)
      bufferModel.setNavColumn(targetCol)
      bufferModel.focusCurrent()
      moved += 1
      logFollow("cursor-move-step", {
        step: i,
        path: "cross-line",
        before,
        nextIndex,
        targetCol,
        moved,
      })
    }
    logFollow("cursor-move-done", {
      delta,
      moved,
      focusedRow: bufferModel.focusedRow(),
      navColumn: bufferModel.navColumn(),
      cursor: bufferModel.getCursorContext(),
    })
    return moved
  }

  const moveCursorWithinBand = (context: FollowOutOfBandContext) => {
    if (!props.isFocused()) {
      logFollow("manual-out-of-band", {
        decision: "autoscroll",
        reason: "unfocused",
        context,
      })
      return "autoscroll" as const
    }
    if (context.delta.y === 0) {
      logFollow("manual-out-of-band", {
        decision: "handled",
        reason: "delta-y-zero",
        context,
      })
      return "handled" as const
    }
    const moved = moveCursorByVisualRows(-context.delta.y)
    if (moved < Math.abs(context.delta.y)) {
      logFollow("manual-out-of-band", {
        decision: "autoscroll",
        reason: "cursor-move-shortfall",
        context,
        moved,
      })
      return "autoscroll" as const
    }
    logFollow("manual-out-of-band", {
      decision: "handled",
      reason: "cursor-moved",
      context,
      moved,
    })
    return "handled" as const
  }

  const handleFollowOutOfBand = (context: FollowOutOfBandContext) => {
    if (context.source !== "manual-scroll") {
      logFollow("follow-out-of-band", {
        source: context.source,
        decision: "autoscroll",
        context,
      })
      return "autoscroll" as const
    }
    const decision = moveCursorWithinBand(context)
    logFollow("follow-out-of-band", {
      source: context.source,
      decision,
      context,
    })
    return decision
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
        pendingEnterFollow = true
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
          scrolloffY: cursorScrolloffY,
          trackX: false,
          manual: true,
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
                    ref={(node) => {
                      if (!node) {
                        rowAnchors.delete(lineId)
                        setAnchorVersion((value) => value + 1)
                        return
                      }
                      rowAnchors.set(lineId, node)
                      setAnchorVersion((value) => value + 1)
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
