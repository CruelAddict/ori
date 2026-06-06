import type { LineNumberRenderable } from "@opentui/core"
import type { SyntaxThemePalette } from "@utils/syntax-highlighter"
import { type Accessor, createEffect } from "solid-js"
import { type LineIndex, lineIndex } from "./coords"

export function createGutter(options: {
  theme: Accessor<SyntaxThemePalette>
  rows: () => number
  isFocused: () => boolean
  cursorLine: () => LineIndex | undefined
  requestRender: () => void
}) {
  let ref: LineNumberRenderable | undefined
  let markers: ReadonlyMap<number, string> = new Map()

  const attach = (node: LineNumberRenderable | undefined) => {
    ref = node
    options.requestRender()
  }

  const setMarkers = (next: ReadonlyMap<number, string>) => {
    markers = next
  }

  const render = () => {
    const node = ref
    if (!node || node.isDestroyed) {
      return
    }

    const rows = options.rows()
    node.height = rows
    node.minHeight = rows
    node.maxHeight = rows

    const signs = new Map<number, { before: string; beforeColor: string }>()
    for (const [line, marker] of markers) {
      if (!marker) {
        continue
      }
      signs.set(line, {
        before: marker,
        beforeColor: options.theme().get("text_muted"),
      })
    }
    node.setLineSigns(signs)

    const colors = new Map<number, { gutter: string; content: string }>()
    if (options.isFocused()) {
      const color = options.theme().get("editor_active_line_background")
      colors.set(options.cursorLine() ?? lineIndex(0), {
        gutter: color,
        content: color,
      })
    }
    node.setLineColors(colors)
  }

  createEffect(() => {
    options.theme().get("text_muted")
    options.isFocused()
    options.cursorLine()
    options.theme().get("editor_active_line_background")
    options.requestRender()
  })

  return {
    attach,
    render,
    setMarkers,
  }
}
