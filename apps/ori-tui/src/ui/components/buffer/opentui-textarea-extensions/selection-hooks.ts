import type { TextareaRenderable } from "@opentui/core"

type TextareaSelectionExtension = TextareaRenderable & {
  onSelectionChanged: (selection: unknown) => boolean
}

type SelectionChangeEvent = {
  ref: TextareaRenderable
  selection: unknown
  result: boolean
}

type SelectionHooks = {
  afterSelectionChange?: (event: SelectionChangeEvent) => void
}

type SelectionState = {
  hooks: SelectionHooks
}

const states = new WeakMap<TextareaRenderable, SelectionState>()

// Installs hook points around OpenTUI selection handling for textarea
export function installSelectionHooks(node: TextareaRenderable, hooks: SelectionHooks) {
  const current = states.get(node)
  if (current) {
    current.hooks = hooks
    return
  }

  const textarea = node as TextareaSelectionExtension
  const state = { hooks } satisfies SelectionState
  const originalOnSelectionChanged = textarea.onSelectionChanged.bind(textarea)
  states.set(node, state)

  textarea.onSelectionChanged = ((selection: unknown) => {
    const result = originalOnSelectionChanged(selection)
    state.hooks.afterSelectionChange?.({ ref: textarea, selection, result })
    return result
  }) as TextareaSelectionExtension["onSelectionChanged"]
}
