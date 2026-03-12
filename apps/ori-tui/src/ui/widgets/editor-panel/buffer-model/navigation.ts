import type { TextareaRenderable } from "@opentui/core"
import type { BufferModel, CursorContext, Line } from "./model"

export function getLineRef(buffer: BufferModel, index: number) {
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

export function getVisualEOLColumn(buffer: BufferModel, index: number): number {
  const ref = getLineRef(buffer, index)
  if (!ref) {
    return 0
  }
  return ref.editorView.getVisualEOL().logicalCol
}

export function focusLine(buffer: BufferModel, index: number, column: number) {
  const node = getLineRef(buffer, index)
  if (!node) {
    return
  }
  if (!buffer.isFocused()) {
    return
  }

  node.focus()
  const targetCol = Math.min(column, buffer._getLineDisplayWidth(index))
  node.editBuffer.setCursorToLineCol(0, targetCol)
  buffer.setFocusedRow(index)
}

export function moveFocus(buffer: BufferModel, index: number, column: number) {
  buffer.setFocusedRow(index)
  buffer.setNavColumn(column)
  queueMicrotask(() => focusLine(buffer, index, column))
}

export function focusCurrent(buffer: BufferModel) {
  focusLine(buffer, buffer.focusedRow(), buffer.navColumn())
}

export function clampFocus(buffer: BufferModel, lines: Line[] = buffer.lines()) {
  const targetRow = Math.min(buffer.focusedRow(), Math.max(0, lines.length - 1))
  const targetCol = Math.min(buffer.navColumn(), buffer._getLineDisplayWidth(targetRow))
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

export function getCursorContext(buffer: BufferModel): CursorContext | undefined {
  const index = buffer.focusedRow()
  const node = getLineRef(buffer, index)
  if (!node) {
    return undefined
  }
  const cursor = node.logicalCursor
  return { index, cursorCol: cursor.col, cursorRow: cursor.row }
}

export function handleVerticalMove(buffer: BufferModel, index: number, delta: -1 | 1) {
  const targetIndex = index + delta
  if (buffer.lines()[targetIndex] === undefined) {
    return
  }
  const targetCol = Math.min(buffer.navColumn(), buffer._getLineDisplayWidth(targetIndex))
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

  const ref = getLineRef(buffer, before.index)
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
  if (after && (after.cursorRow !== before.cursorRow || after.cursorCol !== before.cursorCol)) {
    buffer.setNavColumn(after.cursorCol)
    return true
  }

  const next = before.index + dir
  if (!buffer.lines()[next]) {
    return false
  }

  const col = Math.min(buffer.navColumn(), getVisualEOLColumn(buffer, next))
  buffer.setFocusedRow(next)
  buffer.setNavColumn(col)
  focusCurrent(buffer)
  return true
}

export function handleHorizontalJump(buffer: BufferModel, index: number, toPrevious: boolean) {
  if (toPrevious) {
    const targetIndex = index - 1
    if (targetIndex < 0) {
      return
    }
    moveFocus(buffer, targetIndex, buffer._getLineDisplayWidth(targetIndex))
    return
  }

  const targetIndex = index + 1
  if (buffer.lines()[targetIndex] === undefined) {
    return
  }
  moveFocus(buffer, targetIndex, 0)
}
