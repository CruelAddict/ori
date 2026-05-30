import type { TextareaRenderable } from "@opentui/core"

type TextareaViewportSizeExtension = TextareaRenderable & {
  editorView: {
    setViewportSize: (width: number, height: number) => void
  }
}

type TextareaViewport = ReturnType<TextareaRenderable["editorView"]["getViewport"]>

type ViewportSizeEvent = {
  ref: TextareaRenderable
  width: number
  height: number
  previousViewport: TextareaViewport
}

type ViewportSizeHooks = {
  beforeViewportSizeChange?: (event: ViewportSizeEvent) => void
  afterViewportSizeChange?: (event: ViewportSizeEvent) => void
}

type ViewportSizeState = {
  hooks: ViewportSizeHooks
}

const states = new WeakMap<TextareaRenderable, ViewportSizeState>()

// Installs hook points around OpenTUI setViewportSize
export function installViewportSizeHooks(node: TextareaRenderable, hooks: ViewportSizeHooks) {
  const current = states.get(node)
  if (current) {
    current.hooks = hooks
    return
  }

  const textarea = node as TextareaViewportSizeExtension
  const state = { hooks } satisfies ViewportSizeState
  const originalSetViewportSize = textarea.editorView.setViewportSize.bind(textarea.editorView)
  states.set(node, state)

  textarea.editorView.setViewportSize = ((width, height) => {
    const event = {
      ref: textarea,
      width,
      height,
      previousViewport: textarea.editorView.getViewport(),
    } satisfies ViewportSizeEvent
    state.hooks.beforeViewportSizeChange?.(event)
    const result = originalSetViewportSize(width, height)
    state.hooks.afterViewportSizeChange?.(event)
    return result
  }) as TextareaViewportSizeExtension["editorView"]["setViewportSize"]
}
