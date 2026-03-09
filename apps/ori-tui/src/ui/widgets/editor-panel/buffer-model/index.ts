import { createBufferContext } from "./context"
import * as edit from "./editing"
import * as hl from "./highlighting"
import * as nav from "./navigation"
import type { BufferModelOptions } from "./state"

export type { BufferModelOptions }
export type { CursorContext } from "./navigation"

export function createBufferModel(options: BufferModelOptions) {
  const buffer = createBufferContext(options)

  hl.mountHighlighting(buffer)
  hl.requestHighlights(buffer)

  return {
    lines: buffer.lines,
    lineIds: buffer.lineIds,
    linesById: buffer.linesById,
    statements: buffer.statements,
    statementAtCursor: buffer.statementAtCursor,
    focusedRow: buffer.state.session.focusedRow,
    navColumn: buffer.state.session.navColumn,
    setLineRef: (lineId: string, ref: Parameters<typeof nav.setLineRef>[2]) => {
      nav.setLineRef(buffer, lineId, ref, () => hl.requestHighlights(buffer))
    },
    getLineRef: (index: number) => nav.getLineRef(buffer, index),
    getVisualEOLColumn: (index: number) => nav.getVisualEOLColumn(buffer, index),
    setFocusedRow: buffer.state.session.setFocusedRow,
    setNavColumn: buffer.state.session.setNavColumn,
    setText: (text: string) => edit.setText(buffer, text),
    focusCurrent: () => nav.focusCurrent(buffer),
    handleFocusChange: (isFocused: boolean) => nav.handleFocusChange(buffer, isFocused),
    handleTextAreaChange: (index: number) => edit.handleTextAreaChange(buffer, index),
    getCursorContext: () => nav.getCursorContext(buffer),
    handleEnter: (index: number) => edit.handleEnter(buffer, index),
    handleBackwardMerge: (index: number) => edit.handleBackwardMerge(buffer, index),
    handleForwardMerge: (index: number) => edit.handleForwardMerge(buffer, index),
    handleVerticalMove: (index: number, delta: -1 | 1) => nav.handleVerticalMove(buffer, index, delta),
    moveCursorByVisualRows: (delta: number) => nav.moveCursorByVisualRows(buffer, delta),
    handleHorizontalJump: (index: number, toPrevious: boolean) =>
      nav.handleHorizontalJump(buffer, index, toPrevious),
    clampFocus: (lines = buffer.lines()) => nav.clampFocus(buffer, lines),
    flush: () => edit.flush(buffer),
    dispose: () => edit.dispose(buffer),
  }
}

export type BufferModel = ReturnType<typeof createBufferModel>
