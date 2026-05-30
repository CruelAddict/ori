import type { TextareaRenderable } from "@opentui/core"

type TextareaCursorMovementExtension = TextareaRenderable & {
  editorView: {
    moveUpVisual: () => void
    moveDownVisual: () => void
  }
}

type CursorMovementEvent = {
  ref: TextareaRenderable
  kind: "visual"
  direction: "up" | "down"
}

type CursorMovementHooks = {
  beforeVisualMove?: (event: CursorMovementEvent) => void
  afterVisualMove?: (event: CursorMovementEvent) => void
}

type CursorMovementState = {
  hooks: CursorMovementHooks
}

const states = new WeakMap<TextareaRenderable, CursorMovementState>()

// Installs hook points around OpenTUI visual cursor movement methods.
export function installCursorMovementHooks(node: TextareaRenderable, hooks: CursorMovementHooks) {
  const current = states.get(node)
  if (current) {
    current.hooks = hooks
    return
  }

  const textarea = node as TextareaCursorMovementExtension
  const state = { hooks } satisfies CursorMovementState
  const originalMoveUpVisual = textarea.editorView.moveUpVisual.bind(textarea.editorView)
  const originalMoveDownVisual = textarea.editorView.moveDownVisual.bind(textarea.editorView)
  states.set(node, state)

  textarea.editorView.moveUpVisual = (() => {
    const event = { ref: textarea, kind: "visual", direction: "up" } satisfies CursorMovementEvent
    state.hooks.beforeVisualMove?.(event)
    const result = originalMoveUpVisual()
    state.hooks.afterVisualMove?.(event)
    return result
  }) as TextareaCursorMovementExtension["editorView"]["moveUpVisual"]

  textarea.editorView.moveDownVisual = (() => {
    const event = { ref: textarea, kind: "visual", direction: "down" } satisfies CursorMovementEvent
    state.hooks.beforeVisualMove?.(event)
    const result = originalMoveDownVisual()
    state.hooks.afterVisualMove?.(event)
    return result
  }) as TextareaCursorMovementExtension["editorView"]["moveDownVisual"]
}
