import { type DocCharOffset, docCharOffset } from "./coords"
import type { Document } from "./document"
import type { BufferTextareaCursorChangeCause } from "./buffer-textarea-adapter"
import type { TextGeometry } from "./text-geometry"

type TextareaEditBridge = {
  readCursor: () => { logicalRow: number; logicalCol: number } | undefined
  setCursor: (row: number, col: number, cause?: BufferTextareaCursorChangeCause) => void
  requestRender: () => void
}

type CreateBufferEditCommandsOptions = {
  textarea: TextareaEditBridge
  geometry: TextGeometry
  resetCursorTracking: () => void
}

export type BufferReplaceEdit = {
  start: DocCharOffset
  end: DocCharOffset
  insertText: string
  cursorOffsetFromStart?: number
}

export type BufferAppliedEdit = {
  text: string
  cursorOffset: DocCharOffset
}

function applyReplaceEdit(document: Document, edit: BufferReplaceEdit): BufferAppliedEdit {
  return {
    text: document.text.slice(0, edit.start) + edit.insertText + document.text.slice(edit.end),
    cursorOffset: docCharOffset(edit.start + (edit.cursorOffsetFromStart ?? edit.insertText.length)),
  }
}

function getDeleteToLineStartEdit(document: Document, offset: DocCharOffset): BufferReplaceEdit | undefined {
  const text = document.text
  const cursor = document.positionAtOffset(offset)
  const lineStart = document.lineStart(cursor.line)
  const needsEofWorkaround = cursor.line === document.lineStarts.length - 1 && offset === text.length

  if (cursor.offset > 0) {
    if (needsEofWorkaround) {
      // OpenTUI loses the final blank line for this edge case when deleting a
      // line-local range, so replace the full document and put the cursor back.
      return {
        start: docCharOffset(0),
        end: docCharOffset(text.length),
        insertText: text.slice(0, lineStart) + text.slice(offset),
        cursorOffsetFromStart: lineStart,
      }
    }

    return {
      start: lineStart,
      end: offset,
      insertText: "",
      cursorOffsetFromStart: 0,
    }
  }

  if (cursor.line > 0) {
    if (needsEofWorkaround) {
      const nextCursorOffset = lineStart - 1
      return {
        start: docCharOffset(0),
        end: docCharOffset(text.length),
        insertText: text.slice(0, nextCursorOffset) + text.slice(lineStart),
        cursorOffsetFromStart: nextCursorOffset,
      }
    }

    return {
      start: docCharOffset(lineStart - 1),
      end: lineStart,
      insertText: "",
      cursorOffsetFromStart: 0,
    }
  }

  return undefined
}

export function createBufferEditCommands(options: CreateBufferEditCommandsOptions) {
  const setCursorDocOffset = (offset: DocCharOffset, cause: BufferTextareaCursorChangeCause = "buffer") => {
    if (!options.textarea.readCursor()) {
      return false
    }

    options.resetCursorTracking()
    const document = options.geometry.document
    const next = document.positionAtOffset(offset)
    options.textarea.setCursor(next.line, next.offset, cause)
    options.textarea.requestRender()
    return true
  }

  const replaceDocRange = (
    start: DocCharOffset,
    end: DocCharOffset,
    insertText: string,
    nextCursorOffset?: number,
  ) => {
    const document = options.geometry.document
    return applyReplaceEdit(document, {
      start,
      end,
      insertText,
      cursorOffsetFromStart: nextCursorOffset,
    })
  }

  const deleteToLineStart = () => {
    const cursor = options.textarea.readCursor()
    if (!cursor) {
      return undefined
    }

    const document = options.geometry.document
    const offset = document.offsetAtLineChar(cursor.logicalRow, cursor.logicalCol)
    const edit = getDeleteToLineStartEdit(document, offset)
    if (!edit) {
      return undefined
    }

    return applyReplaceEdit(document, edit)
  }

  return {
    setCursorDocOffset,
    replaceDocRange,
    deleteToLineStart,
  }
}
