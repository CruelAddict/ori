import type { BufferTextareaVisualLayout } from "./buffer-textarea-adapter"
import {
  type ContainerX,
  type ContainerY,
  containerX,
  containerY,
  type DisplayColumn,
  type DocCharOffset,
  displayColumn,
  docCharOffset,
  type LineIndex,
  lineIndex,
  type VisualRow,
  visualColumn,
  visualRow,
} from "./coords"
import type { TextGeometry } from "./text-geometry"

export type ViewportPoint = {
  x: ContainerX
  y: ContainerY
}

function getVisualLineStartColumn(
  layout: BufferTextareaVisualLayout,
  row: VisualRow,
  sourceLine: LineIndex,
): DisplayColumn {
  let firstRow = row
  for (let index = row - 1; index >= 0; index -= 1) {
    if (layout.sourceLines[index] !== sourceLine) {
      break
    }
    firstRow = visualRow(index)
  }

  const firstStart = layout.lineStartColumns[firstRow] ?? 0
  const currentStart = layout.lineStartColumns[row] ?? firstStart
  return displayColumn(Math.max(0, currentStart - firstStart))
}

function findVisualLine(layout: BufferTextareaVisualLayout, sourceLine: LineIndex, displayCol: DisplayColumn) {
  for (let index = 0; index < layout.sourceLines.length; index += 1) {
    if (layout.sourceLines[index] !== sourceLine) {
      continue
    }

    const row = visualRow(index)
    const startColumn = getVisualLineStartColumn(layout, row, sourceLine)
    const nextIndex = index + 1
    const nextStartColumn =
      layout.sourceLines[nextIndex] === sourceLine
        ? getVisualLineStartColumn(layout, visualRow(nextIndex), sourceLine)
        : undefined
    if (nextStartColumn !== undefined && displayCol >= nextStartColumn) {
      continue
    }

    return { row, startColumn }
  }

  return undefined
}

export function resolveViewportOffsetPoint(params: {
  geometry: TextGeometry
  offset: DocCharOffset
  layout: BufferTextareaVisualLayout
  scrollY: number
  viewportHeight: number
}): ViewportPoint | null {
  const point = params.geometry.displayPointAtDocOffset(params.offset)
  const sourceLine = point.line
  const displayCol = point.column
  const line = findVisualLine(params.layout, sourceLine, displayCol)
  if (!line) {
    return null
  }

  const viewportRow = line.row - visualRow(params.scrollY)
  if (viewportRow < 0 || viewportRow >= params.viewportHeight) {
    return null
  }

  const visualCol = visualColumn(Math.max(0, displayCol - line.startColumn))
  return {
    x: containerX(visualCol),
    y: containerY(viewportRow),
  }
}

export function resolveVisualCursorDocOffset(params: {
  geometry: TextGeometry
  visualRow: number
  visualCol: number
  layout: BufferTextareaVisualLayout
}): DocCharOffset | undefined {
  if (params.layout.sourceLines.length === 0) {
    return docCharOffset(0)
  }

  const row = Math.max(0, Math.min(params.visualRow, params.layout.sourceLines.length - 1))
  const sourceLine = params.layout.sourceLines[row]
  if (sourceLine === undefined) {
    return undefined
  }

  const line = lineIndex(sourceLine)
  const startCol = getVisualLineStartColumn(params.layout, visualRow(row), line)
  const width = params.layout.lineWidths[row] ?? 0
  const targetCol = displayColumn(startCol + Math.max(0, Math.min(params.visualCol, width)))
  return params.geometry.docOffsetAtDisplayColumn(line, targetCol)
}
