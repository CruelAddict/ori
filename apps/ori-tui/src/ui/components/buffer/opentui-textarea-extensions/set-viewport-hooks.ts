import type { TextareaRenderable } from "@opentui/core"

type TextareaSetViewportExtension = TextareaRenderable & {
  editorView: {
    setViewport: (x: number, y: number, width: number, height: number, moveCursor?: boolean) => void
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

export type SetViewportResult = {
  cursorChanged: boolean
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
  emitAfterHook = true,
) {
  const event = {
    ref,
    x,
    y,
    width,
    height,
    moveCursor,
    previousViewport: ref.editorView.getViewport(),
    previousCursor: readCursor(ref),
  } satisfies SetViewportBeforeEvent
  state.hooks.beforeSetViewport?.(event)
  state.nativeSetViewport(x, y, width, height, moveCursor)
  const result = {
    cursorChanged: hasCursorChanged(ref, event.previousCursor),
  } satisfies SetViewportResult
  if (!emitAfterHook) {
    return result
  }

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
  textarea.editorView.setViewport = ((x, y, width, height, moveCursor = false) => {
    applySetViewport(textarea, state, x, y, width, height, moveCursor, true)
  }) as TextareaSetViewportExtension["editorView"]["setViewport"]
}

// Buffer-owned viewport changes need cache invalidation, but the caller owns
// app-level reactions. Return whether OpenTUI moved the cursor while applying it.
export function setViewportAndReadCursorChange(
  ref: TextareaRenderable,
  x: number,
  y: number,
  width: number,
  height: number,
  moveCursor = false,
): SetViewportResult {
  const state = states.get(ref)
  if (!state) {
    const previousCursor = readCursor(ref)
    ref.editorView.setViewport(x, y, width, height, moveCursor)
    return {
      cursorChanged: hasCursorChanged(ref, previousCursor),
    }
  }

  return applySetViewport(ref, state, x, y, width, height, moveCursor, false)
}
