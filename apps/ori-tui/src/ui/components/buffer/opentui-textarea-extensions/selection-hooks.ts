import type { Selection, TextareaRenderable } from "@opentui/core"

type TextareaSelectionExtension = TextareaRenderable & {
  onSelectionChanged: (selection: Selection | null) => boolean
}

export type SelectionChangeEvent = {
  ref: TextareaRenderable
  selection: Selection | null
  result?: boolean
}

type SelectionHooks = {
  beforeSelectionChange?: (event: SelectionChangeEvent) => void
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

  textarea.onSelectionChanged = ((selection: Selection | null) => {
    state.hooks.beforeSelectionChange?.({ ref: textarea, selection })
    const result = originalOnSelectionChanged(selection)
    state.hooks.afterSelectionChange?.({ ref: textarea, selection, result })
    return result
  }) as TextareaSelectionExtension["onSelectionChanged"]
}
