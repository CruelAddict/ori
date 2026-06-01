import type { LineNumberRenderable } from "@opentui/core"
import type { Accessor } from "solid-js"
import { type LineIndex, lineIndex } from "./coords"

const EMPTY_GUTTER_MARKERS = new Map<number, string>()

type BufferGutterPalette = Accessor<{
  get: (name: string) => string
}>

type CreateBufferGutterAdapterOptions = {
  palette: BufferGutterPalette
  isFocused: Accessor<boolean>
  getCursorLine: () => LineIndex | undefined
  getMarkers: () => ReadonlyMap<number, string> | undefined
  queueRender: () => void
}

export function createBufferGutterAdapter(options: CreateBufferGutterAdapterOptions) {
  let ref: LineNumberRenderable | undefined

  return {
    attach: (node: LineNumberRenderable | undefined) => {
      ref = node
      options.queueRender()
    },
    renderViewportRows: (rows: number) => {
      if (!ref || ref.isDestroyed) {
        return
      }

      ref.height = rows
      ref.minHeight = rows
      ref.maxHeight = rows
    },
    renderMarkers: () => {
      if (!ref || ref.isDestroyed) {
        return
      }

      const signs = new Map<number, { before: string; beforeColor: string }>()
      for (const [line, marker] of options.getMarkers() ?? EMPTY_GUTTER_MARKERS) {
        if (!marker) {
          continue
        }
        signs.set(line, {
          before: marker,
          beforeColor: options.palette().get("text_muted"),
        })
      }
      ref.setLineSigns(signs)
    },
    renderCursorLine: () => {
      if (!ref || ref.isDestroyed) {
        return
      }

      const colors = new Map<number, { gutter: string; content: string }>()
      if (options.isFocused()) {
        colors.set(options.getCursorLine() ?? lineIndex(0), {
          gutter: options.palette().get("editor_active_line_background"),
          content: options.palette().get("editor_active_line_background"),
        })
      }
      ref.setLineColors(colors)
    },
  }
}

export type BufferGutterAdapter = ReturnType<typeof createBufferGutterAdapter>
