import type { TextareaRenderable } from "@opentui/core"

export type SetViewportOptions = {
  notify?: boolean
}

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
  notify: boolean
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
  return (
    ref.logicalCursor.row !== previous.logicalRow ||
    ref.logicalCursor.col !== previous.logicalCol ||
    ref.visualCursor.visualRow !== previous.visualRow ||
    ref.visualCursor.visualCol !== previous.visualCol
  )
}

function applySetViewport(
  ref: TextareaRenderable,
  state: SetViewportState,
  x: number,
  y: number,
  width: number,
  height: number,
  moveCursor = false,
  options?: SetViewportOptions,
) {
  const event = {
    ref,
    x,
    y,
    width,
    height,
    moveCursor,
    notify: options?.notify !== false,
    previousViewport: ref.editorView.getViewport(),
    previousCursor: readCursor(ref),
  } satisfies SetViewportBeforeEvent
  state.hooks.beforeSetViewport?.(event)
  state.nativeSetViewport(x, y, width, height, moveCursor)
  state.hooks.afterSetViewport?.({
    ...event,
    cursorChanged: hasCursorChanged(ref, event.previousCursor),
  })
}

// Installs hook points around OpenTUI setViewport. Direct OpenTUI calls and
// controlled setTextareaViewport calls share the same before/after hook path.
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
    applySetViewport(textarea, state, x, y, width, height, moveCursor)
  }) as TextareaSetViewportExtension["editorView"]["setViewport"]
}

// Use this for internal multi-step viewport operations
export function setTextareaViewport(
  ref: TextareaRenderable,
  x: number,
  y: number,
  width: number,
  height: number,
  moveCursor = false,
  options?: SetViewportOptions,
) {
  const state = states.get(ref)
  if (!state) {
    ref.editorView.setViewport(x, y, width, height, moveCursor)
    return
  }

  applySetViewport(ref, state, x, y, width, height, moveCursor, options)
}
