import { type DocCharOffset, docCharOffset } from "./coords"
import { Document } from "./document"
import type { TextGeometry } from "./text-geometry"

type TextareaEditBridge = {
  readCursor: () => unknown
  setCursor: (row: number, col: number) => void
  deleteRange: (startRow: number, startCol: number, endRow: number, endCol: number) => void
  insertText: (text: string) => void
  readText: () => string | undefined
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

export function getDeleteToLineStartEdit(document: Document, offset: DocCharOffset): BufferReplaceEdit | undefined {
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
  const setCursorDocOffset = (offset: DocCharOffset) => {
    if (!options.textarea.readCursor()) {
      return false
    }

    options.resetCursorTracking()
    const document = options.geometry.document
    const next = document.positionAtOffset(offset)
    options.textarea.setCursor(next.line, next.offset)
    options.textarea.requestRender()
    return true
  }

  const replaceDocRange = (start: DocCharOffset, end: DocCharOffset, insertText: string, nextCursorOffset?: number) => {
    const text = options.textarea.readText()
    if (text === undefined) {
      return false
    }

    const document = options.geometry.document
    const from = document.positionAtOffset(start)
    const to = document.positionAtOffset(end)
    options.resetCursorTracking()
    options.textarea.setCursor(from.line, from.offset)
    if (start !== end) {
      options.textarea.deleteRange(from.line, from.offset, to.line, to.offset)
      options.textarea.setCursor(from.line, from.offset)
    }
    if (insertText) {
      options.textarea.insertText(insertText)
    }

    const finalOffset = docCharOffset(start + (nextCursorOffset ?? insertText.length))
    const final = Document.create(options.textarea.readText() ?? text).positionAtOffset(finalOffset)
    options.textarea.setCursor(final.line, final.offset)
    options.textarea.requestRender()
    return true
  }

  return {
    setCursorDocOffset,
    replaceDocRange,
  }
}
