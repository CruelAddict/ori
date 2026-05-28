import type { LineInfo } from "@opentui/core"
import { type DocCharRange, docCharRange, type LineIndex, lineIndex } from "./coords"
import type { TextGeometry } from "./text-geometry"

export type Viewport = {
  geometry: TextGeometry
  lineInfo: LineInfo
  scrollY: number
  height: number
  focusedLine: LineIndex
}

export function createViewport(params: Viewport): Viewport {
  return params
}

export function viewportRenderRange(viewport: Viewport, overscan: number): DocCharRange | undefined {
  const startRow = Math.max(0, viewport.scrollY - overscan)
  const endRow = Math.min(viewport.lineInfo.lineSources.length, viewport.scrollY + viewport.height + overscan)
  let startLine: number | undefined
  let endLine: number | undefined
  for (let row = startRow; row < endRow; row += 1) {
    const line = viewport.lineInfo.lineSources[row]
    if (line === undefined) {
      continue
    }
    startLine = startLine === undefined ? line : Math.min(startLine, line)
    endLine = endLine === undefined ? line : Math.max(endLine, line)
  }
  if (startLine === undefined || endLine === undefined) {
    return undefined
  }

  return docCharRange(
    viewport.geometry.document.lineStart(lineIndex(startLine)),
    viewport.geometry.document.nextLineStart(lineIndex(endLine)),
  )
}
