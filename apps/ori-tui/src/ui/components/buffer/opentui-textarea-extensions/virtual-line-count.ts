import type { TextareaRenderable } from "@opentui/core"

const textareas = new WeakSet<TextareaRenderable>()

// TextareaRenderable.virtualLineCount can be stale for wrapped content. Expose
// the editor view's current virtual row count for external layout/scroll metrics.
export function exposeVirtualLineCount(node: TextareaRenderable) {
  if (textareas.has(node)) {
    return
  }

  Object.defineProperty(node, "virtualLineCount", {
    configurable: true,
    get() {
      return this.editorView.getTotalVirtualLineCount()
    },
  })

  textareas.add(node)
}
