import type { TextareaRenderable } from "@opentui/core"
import type { DisplayColumn, LineIndex } from "./coords"

export type BufferHighlight = {
  start: DisplayColumn
  end: DisplayColumn
  styleId: number
  groupId: number
}

export type RenderTarget = {
  addHighlight: (line: LineIndex, highlight: BufferHighlight) => void
  removeHighlightsByRef: (groupId: number) => void
  requestRender: () => void
}

export function createTextareaRenderTarget(ref: TextareaRenderable): RenderTarget {
  return {
    addHighlight: (line, highlight) => {
      ref.editBuffer.addHighlight(line, {
        start: highlight.start,
        end: highlight.end,
        styleId: highlight.styleId,
        hlRef: highlight.groupId,
      })
    },
    removeHighlightsByRef: (groupId) => {
      ref.editBuffer.removeHighlightsByRef(groupId)
    },
    requestRender: () => {
      ref.requestRender()
    },
  }
}
