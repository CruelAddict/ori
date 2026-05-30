import type { MouseEvent, TextareaRenderable } from "@opentui/core"

type TextareaMouseExtension = TextareaRenderable & {
  onMouseEvent: (event: MouseEvent) => void
}

const textareas = new WeakSet<TextareaRenderable>()

export function disableScroll(node: TextareaRenderable) {
  if (textareas.has(node)) {
    return
  }

  const textarea = node as unknown as TextareaMouseExtension
  const originalOnMouseEvent = textarea.onMouseEvent.bind(node)
  textarea.onMouseEvent = ((event: MouseEvent) => {
    if (event.type === "scroll") {
      return
    }

    originalOnMouseEvent(event)
  }) as typeof textarea.onMouseEvent

  textareas.add(node)
}
