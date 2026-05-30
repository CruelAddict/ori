import type { TextareaRenderable } from "@opentui/core"

type SetViewportSource = "external" | "buffer"

export type SetViewportResult = {
  cursorChanged: boolean
}

export type SetViewport = (
  x: number,
  y: number,
  width: number,
  height: number,
  moveCursor?: boolean,
  context?: { source?: SetViewportSource },
) => SetViewportResult

type TextareaSetViewportExtension = TextareaRenderable & {
  editorView: {
    setViewport: SetViewport
  }
}

type TextareaViewport = ReturnType<TextareaRenderable["editorView"]["getViewport"]>

type CursorSnapshot = {
  logicalRow: number
  logicalCol: number
  visualRow: number
  visualCol: number
}

type SetViewportBeforeEvent = {
  ref: TextareaRenderable
  x: number
  y: number
  width: number
  height: number
  moveCursor: boolean
  source: SetViewportSource
  previousViewport: TextareaViewport
  previousCursor: CursorSnapshot
}

type SetViewportAfterEvent = SetViewportBeforeEvent & {
  cursorChanged: boolean
}

type SetViewportHooks = {
  beforeSetViewport?: (event: SetViewportBeforeEvent) => void
  afterSetViewport?: (event: SetViewportAfterEvent) => void
}

type SetViewportState = {
  nativeSetViewport: (x: number, y: number, width: number, height: number, moveCursor?: boolean) => void
  hooks: SetViewportHooks
}

const states = new WeakMap<TextareaRenderable, SetViewportState>()

function readCursor(ref: TextareaRenderable) {
  return {
    logicalRow: ref.logicalCursor.row,
    logicalCol: ref.logicalCursor.col,
    visualRow: ref.visualCursor.visualRow,
    visualCol: ref.visualCursor.visualCol,
  } satisfies CursorSnapshot
}

function hasCursorChanged(ref: TextareaRenderable, previous: CursorSnapshot) {
  return ref.logicalCursor.row !== previous.logicalRow || ref.logicalCursor.col !== previous.logicalCol
}

function applySetViewport(
  ref: TextareaRenderable,
  state: SetViewportState,
  x: number,
  y: number,
  width: number,
  height: number,
  moveCursor = false,
  context: Parameters<SetViewport>[5] = {},
) {
  const event = {
    ref,
    x,
    y,
    width,
    height,
    moveCursor,
    source: context.source ?? "external",
    previousViewport: ref.editorView.getViewport(),
    previousCursor: readCursor(ref),
  } satisfies SetViewportBeforeEvent
  state.hooks.beforeSetViewport?.(event)
  state.nativeSetViewport(x, y, width, height, moveCursor)
  const result = {
    cursorChanged: hasCursorChanged(ref, event.previousCursor),
  } satisfies SetViewportResult

  state.hooks.afterSetViewport?.({
    ...event,
    ...result,
  })
  return result
}

// Installs hook points around OpenTUI setViewport.
export function installSetViewportHooks(node: TextareaRenderable, hooks: SetViewportHooks) {
  const current = states.get(node)
  if (current) {
    current.hooks = hooks
    return
  }

  const textarea = node as TextareaSetViewportExtension
  const state = {
    nativeSetViewport: textarea.editorView.setViewport.bind(textarea.editorView),
    hooks,
  } satisfies SetViewportState
  states.set(node, state)
  textarea.editorView.setViewport = ((
    x: number,
    y: number,
    width: number,
    height: number,
    moveCursor = false,
    context?: Parameters<SetViewport>[5],
  ) => {
    return applySetViewport(textarea, state, x, y, width, height, moveCursor, context)
  }) as TextareaSetViewportExtension["editorView"]["setViewport"]
}
