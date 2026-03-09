import type { TextareaRenderable } from "@opentui/core"
import type { BufferContext } from "./context"
import type { Line } from "./lines"
import { extractWidthMethod } from "./lines"

export type CursorContext = {
  index: number
  cursorCol: number
  cursorRow: number
}

export function getLineRef(buffer: BufferContext, index: number) {
  const line = buffer.lines()[index]
  if (!line) {
    return undefined
  }
  return buffer.state.resources.lineRefs.get(line.id)
}

export function setLineRef(
  buffer: BufferContext,
  lineId: string,
  ref: TextareaRenderable | undefined,
  onWidthMethodExtracted: () => void,
) {
  if (!ref) {
    buffer.state.resources.lineRefs.delete(lineId)
    return
  }

  buffer.state.resources.lineRefs.set(lineId, ref)
  if (extractWidthMethod(ref)) {
    onWidthMethodExtracted()
  }
}

export function deleteStaleRefs(buffer: BufferContext, lines: Line[]) {
  const ids = new Set(lines.map((line) => line.id))
  for (const id of buffer.state.resources.lineRefs.keys()) {
    if (!ids.has(id)) {
      buffer.state.resources.lineRefs.delete(id)
    }
  }
}

export function getVisualEOLColumn(buffer: BufferContext, index: number): number {
  const ref = getLineRef(buffer, index)
  if (!ref) {
    return 0
  }
  return ref.editorView.getVisualEOL().logicalCol
}

export function focusLine(buffer: BufferContext, index: number, column: number) {
  const node = getLineRef(buffer, index)
  if (!node) {
    return
  }
  if (!buffer.state.ports.isFocused()) {
    return
  }

  node.focus()
  const targetCol = Math.min(column, buffer.getLineDisplayWidth(index))
  node.editBuffer.setCursorToLineCol(0, targetCol)
  buffer.state.session.setFocusedRow(index)
}

export function moveFocus(buffer: BufferContext, index: number, column: number) {
  buffer.state.session.setFocusedRow(index)
  buffer.state.session.setNavColumn(column)
  queueMicrotask(() => focusLine(buffer, index, column))
}

export function focusCurrent(buffer: BufferContext) {
  focusLine(buffer, buffer.state.session.focusedRow(), buffer.state.session.navColumn())
}

export function clampFocus(buffer: BufferContext, lines: Line[] = buffer.lines()) {
  const targetRow = Math.min(buffer.state.session.focusedRow(), Math.max(0, lines.length - 1))
  const targetCol = Math.min(buffer.state.session.navColumn(), buffer.getLineDisplayWidth(targetRow))
  moveFocus(buffer, targetRow, targetCol)
}

export function handleFocusChange(buffer: BufferContext, isFocused: boolean) {
  const target = getLineRef(buffer, buffer.state.session.focusedRow())
  if (!target) {
    return
  }
  if (!isFocused) {
    target.blur()
    return
  }
  focusCurrent(buffer)
}

export function getCursorContext(buffer: BufferContext): CursorContext | undefined {
  const index = buffer.state.session.focusedRow()
  const node = getLineRef(buffer, index)
  if (!node) {
    return undefined
  }
  const cursor = node.logicalCursor
  return { index, cursorCol: cursor.col, cursorRow: cursor.row }
}

export function handleVerticalMove(buffer: BufferContext, index: number, delta: -1 | 1) {
  const targetIndex = index + delta
  if (buffer.lines()[targetIndex] === undefined) {
    return
  }
  const targetCol = Math.min(buffer.state.session.navColumn(), buffer.getLineDisplayWidth(targetIndex))
  moveFocus(buffer, targetIndex, targetCol)
}

export function moveCursorByVisualRows(buffer: BufferContext, delta: number): number {
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

function tryMoveOneVisualRow(buffer: BufferContext, dir: -1 | 1): boolean {
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
    buffer.state.session.setNavColumn(after.cursorCol)
    return true
  }

  const next = before.index + dir
  if (!buffer.lines()[next]) {
    return false
  }

  const col = Math.min(buffer.state.session.navColumn(), getVisualEOLColumn(buffer, next))
  buffer.state.session.setFocusedRow(next)
  buffer.state.session.setNavColumn(col)
  focusCurrent(buffer)
  return true
}

export function handleHorizontalJump(buffer: BufferContext, index: number, toPrevious: boolean) {
  if (toPrevious) {
    const targetIndex = index - 1
    if (targetIndex < 0) {
      return
    }
    moveFocus(buffer, targetIndex, buffer.getLineDisplayWidth(targetIndex))
    return
  }

  const targetIndex = index + 1
  if (buffer.lines()[targetIndex] === undefined) {
    return
  }
  moveFocus(buffer, targetIndex, 0)
}
