import type { TextareaRenderable } from "@opentui/core"
import {
  type BufferCursor,
  clampDisplayColumn,
  type DisplayColumn,
  type DocCharOffset,
  displayColumn,
  docCharOffset,
  type LineIndex,
  lineIndex,
} from "./coords"
import type { BufferModel, Line } from "./model"
import { displayColumnToLineCharOffset, getTabWidth } from "./text-metrics"

export function getLineRef(buffer: BufferModel, index: LineIndex) {
  const line = buffer.lines()[index]
  return line && buffer._lineRefs.get(line.id)
}

export function setLineRef(buffer: BufferModel, lineId: string, ref: TextareaRenderable | undefined) {
  if (!ref) {
    buffer._lineRefs.delete(lineId)
    return
  }

  const prev = buffer._lineRefs.get(lineId)
  if (prev === ref) {
    return
  }

  buffer._lineRefs.set(lineId, ref)
  if (buffer._syntaxStyle) {
    ref.syntaxStyle = buffer._syntaxStyle
  }
  if (!buffer._widthMethod && ref.ctx?.widthMethod) {
    buffer._widthMethod = ref.ctx.widthMethod
  }

  buffer._reapplyLineHighlight(lineId)
}

export function getVisualEOLColumn(buffer: BufferModel, index: LineIndex): DisplayColumn {
  const ref = getLineRef(buffer, index)
  if (!ref) {
    return displayColumn(0)
  }
  return displayColumn(ref.editorView.getVisualEOL().logicalCol)
}

export function focusLine(buffer: BufferModel, index: LineIndex, column: DisplayColumn) {
  const node = getLineRef(buffer, index)
  if (!node) {
    return
  }
  if (!buffer.isFocused()) {
    return
  }

  node.focus()
  const targetCol = clampDisplayColumn(column, buffer._getLineDisplayWidth(index))
  node.editBuffer.setCursorToLineCol(0, targetCol)
  buffer.setFocusedRow(index)
}

export function moveFocus(buffer: BufferModel, index: LineIndex, column: DisplayColumn) {
  buffer.setFocusedRow(index)
  buffer.setNavColumn(column)
  queueMicrotask(() => focusLine(buffer, index, column))
}

export function focusCurrent(buffer: BufferModel) {
  focusLine(buffer, buffer.focusedRow(), buffer.navColumn())
}

export function clampFocus(buffer: BufferModel, lines: Line[] = buffer.lines()) {
  const targetRow = lineIndex(Math.min(buffer.focusedRow(), Math.max(0, lines.length - 1)))
  const targetCol = clampDisplayColumn(buffer.navColumn(), buffer._getLineDisplayWidth(targetRow))
  moveFocus(buffer, targetRow, targetCol)
}

export function handleFocusChange(buffer: BufferModel, isFocused: boolean) {
  const target = getLineRef(buffer, buffer.focusedRow())
  if (!target) {
    return
  }
  if (!isFocused) {
    target.blur()
    return
  }
  focusCurrent(buffer)
}

export function getCursorContext(buffer: BufferModel): BufferCursor | undefined {
  const index = buffer.focusedRow()
  const node = getLineRef(buffer, index)
  if (!node) {
    return undefined
  }
  const cursor = node.logicalCursor
  return { line: lineIndex(index), displayCol: displayColumn(cursor.col), row: cursor.row }
}

export function getCursorOffset(buffer: BufferModel): DocCharOffset | undefined {
  const cursor = getCursorContext(buffer)
  if (!cursor) {
    return undefined
  }

  const line = buffer.lines()[cursor.line]
  const ref = getLineRef(buffer, cursor.line)
  if (!line || !ref) {
    return undefined
  }

  const start = buffer.lineStarts()[cursor.line] ?? 0
  const charIndex = displayColumnToLineCharOffset(
    ref.plainText,
    cursor.displayCol,
    getTabWidth(ref),
    buffer._widthMethod,
  )
  return docCharOffset(start + charIndex)
}

export function handleVerticalMove(buffer: BufferModel, index: LineIndex, delta: -1 | 1) {
  const targetIndex = lineIndex(index + delta)
  if (buffer.lines()[targetIndex] === undefined) {
    return
  }
  const targetCol = clampDisplayColumn(buffer.navColumn(), buffer._getLineDisplayWidth(targetIndex))
  moveFocus(buffer, targetIndex, targetCol)
}

export function moveCursorByVisualRows(buffer: BufferModel, delta: number): number {
  if (delta === 0) {
    return 0
  }

  const direction: -1 | 1 = delta > 0 ? 1 : -1
  const steps = Math.abs(delta)
  let moved = 0
  for (let i = 0; i < steps; i += 1) {
    if (!tryMoveOneVisualRow(buffer, direction)) {
      break
    }
    moved += 1
  }
  return moved
}

function tryMoveOneVisualRow(buffer: BufferModel, dir: -1 | 1): boolean {
  const before = getCursorContext(buffer)
  if (!before) {
    return false
  }

  const ref = getLineRef(buffer, before.line)
  if (!ref) {
    return false
  }

  if (dir > 0) {
    ref.moveCursorDown()
  }
  if (dir < 0) {
    ref.moveCursorUp()
  }

  const after = getCursorContext(buffer)
  if (after && (after.row !== before.row || after.displayCol !== before.displayCol)) {
    buffer.setNavColumn(after.displayCol)
    return true
  }

  const next = lineIndex(before.line + dir)
  if (!buffer.lines()[next]) {
    return false
  }

  const col = clampDisplayColumn(buffer.navColumn(), getVisualEOLColumn(buffer, next))
  buffer.setFocusedRow(next)
  buffer.setNavColumn(col)
  focusCurrent(buffer)
  return true
}

export function handleHorizontalJump(buffer: BufferModel, index: LineIndex, toPrevious: boolean) {
  if (toPrevious) {
    const targetIndex = lineIndex(index - 1)
    if (targetIndex < 0) {
      return
    }
    moveFocus(buffer, targetIndex, buffer._getLineDisplayWidth(targetIndex))
    return
  }

  const targetIndex = lineIndex(index + 1)
  if (buffer.lines()[targetIndex] === undefined) {
    return
  }
  moveFocus(buffer, targetIndex, displayColumn(0))
}
