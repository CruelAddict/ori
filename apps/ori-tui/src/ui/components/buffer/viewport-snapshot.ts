import type { BufferTextareaVisualLayout } from "./buffer-textarea-adapter"
import { type DocCharRange, docCharRange, type LineIndex, lineIndex } from "./coords"
import type { TextGeometry } from "./text-geometry"

export type ViewportSnapshot = {
  geometry: TextGeometry
  layout: BufferTextareaVisualLayout
  scrollY: number
  height: number
  focusedLine: LineIndex
}

export function viewportSnapshotRenderRange(viewport: ViewportSnapshot, overscan: number): DocCharRange | undefined {
  const startRow = Math.max(0, viewport.scrollY - overscan)
  const endRow = Math.min(viewport.layout.sourceLines.length, viewport.scrollY + viewport.height + overscan)
  let startLine: number | undefined
  let endLine: number | undefined
  for (let row = startRow; row < endRow; row += 1) {
    const line = viewport.layout.sourceLines[row]
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
