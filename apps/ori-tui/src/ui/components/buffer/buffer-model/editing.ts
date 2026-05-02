import {
  type DisplayColumn,
  displayColumn,
  type LineCharRange,
  type LineIndex,
  lineCharOffset,
  lineIndex,
} from "./coords"
import { reapplyLineHighlight } from "./highlighting"
import type { BufferChangeOrigin, BufferModel, Line } from "./model"
import { clampFocus, getLineRef, moveFocus } from "./navigation"
import {
  lineCharOffsetToDisplayColumn,
  lineCharRangeToDisplayRange,
  lineDisplayColumnToCharOffset,
} from "./text-metrics"

type LineEdit = {
  nextLines: Line[]
  lineIdsToSync: string[]
  focusRow: LineIndex
  focusCol: DisplayColumn
}

type ReplaceRangeInLineOptions = {
  cursorOffset?: number
}

function schedulePush(buffer: BufferModel) {
  buffer.bumpDocumentVersion()
  buffer._requestHighlights()
  buffer._debouncedPush()
}

function syncRefTextWithDocumentState(buffer: BufferModel, lines: Line[], lineIdsToSync: string[]) {
  if (lineIdsToSync.length === 0) {
    return
  }

  queueMicrotask(() => {
    for (const id of lineIdsToSync) {
      const line = lines.find((entry) => entry.id === id)
      if (!line) {
        continue
      }

      const ref = buffer._lineRefs.get(id)
      if (!ref) {
        continue
      }

      if (ref.plainText !== line.text) {
        ref.setText(line.text)
        reapplyLineHighlight(buffer, id)
      }

      buffer.setContentModified(true)
    }
  })
}

function deleteStaleRefs(buffer: BufferModel, lines: Line[]) {
  const ids = new Set(lines.map((line) => line.id))
  for (const id of buffer._lineRefs.keys()) {
    if (!ids.has(id)) {
      buffer._lineRefs.delete(id)
    }
  }
  for (const id of buffer._lineHighlightSpans.keys()) {
    if (!ids.has(id)) {
      buffer._lineHighlightSpans.delete(id)
    }
  }
}

function commitLineEdit(buffer: BufferModel, edit: LineEdit | undefined) {
  if (!edit) {
    return
  }

  buffer._setLines(edit.nextLines)
  deleteStaleRefs(buffer, edit.nextLines)
  buffer.setContentModified(true)
  schedulePush(buffer)
  syncRefTextWithDocumentState(buffer, edit.nextLines, edit.lineIdsToSync)
  moveFocus(buffer, edit.focusRow, edit.focusCol)
}

export function setText(buffer: BufferModel, text: string) {
  const nextLines = buffer._makeLinesFromText(text, false)
  buffer._setLines(nextLines)
  buffer.setContentModified(false)
  deleteStaleRefs(buffer, nextLines)
  clampFocus(buffer, nextLines)
  schedulePush(buffer)
}

export function handleTextAreaChange(buffer: BufferModel, index: LineIndex) {
  const node = getLineRef(buffer, index)
  const line = buffer.lines()[index]
  if (!node || !line) {
    return
  }

  const text = node.plainText
  const cursor = node.logicalCursor
  const pending = buffer._pendingChangeOrigin
  const origin = pending?.origin ?? "user"
  if (pending && pending.remainingEvents > 1) {
    buffer._pendingChangeOrigin = {
      origin: pending.origin,
      remainingEvents: pending.remainingEvents - 1,
    }
  }
  if (!pending || pending.remainingEvents <= 1) {
    buffer._pendingChangeOrigin = undefined
  }
  if (!line.rendered) {
    buffer._setLine(index, { ...line, text, rendered: true })
    return origin
  }
  if (text === line.text) {
    return origin
  }
  if (text.includes("\n")) {
    commitLineEdit(buffer, buildLineSplitEdit(buffer, buffer.lines(), index, text, displayColumn(cursor.col)))
    return origin
  }

  buffer._setLine(index, { ...line, text, rendered: true })
  buffer.setContentModified(true)
  schedulePush(buffer)
  return origin
}

export function replaceTextRange(text: string, start: number, end: number, insertText: string) {
  const safeStart = Math.max(0, Math.min(start, text.length))
  const safeEnd = Math.max(safeStart, Math.min(end, text.length))
  return text.slice(0, safeStart) + insertText + text.slice(safeEnd)
}

export function replaceRangeInLine(
  buffer: BufferModel,
  index: LineIndex,
  range: LineCharRange,
  insertText: string,
  origin: BufferChangeOrigin,
  options: ReplaceRangeInLineOptions = {},
) {
  const line = buffer.lines()[index]
  const ref = getLineRef(buffer, index)
  if (!line || !ref) {
    return false
  }

  const start = range.start
  const end = range.end
  const currentText = ref.plainText
  if (start < 0 || end > currentText.length || start > end) {
    return false
  }

  const nextText = replaceTextRange(currentText, start, end, insertText)
  // A no-op replace can still trip textarea change handling, where identical
  // text short-circuits follow-up work like highlight refresh.
  if (nextText === currentText) {
    return true
  }

  const displayRange = lineCharRangeToDisplayRange(buffer, currentText, range)
  const cursorOffset = options.cursorOffset ?? insertText.length
  const targetOffset = lineCharOffset(start + cursorOffset)
  const targetDisplayCol = lineCharOffsetToDisplayColumn(buffer, nextText, targetOffset)
  const autocompleteEvents = displayRange.start === displayRange.end ? 1 : 2
  buffer._pendingChangeOrigin = {
    origin,
    // Replacing a selection emits two content-change events in OpenTUI:
    // one for deleting the selection and one for inserting the new text.
    remainingEvents: origin === "autocomplete" ? autocompleteEvents : 1,
  }
  if (origin === "autocomplete") {
    // Selection-based replace keeps OpenTUI on its incremental edit path,
    // which avoids clearing all extmarks for the line on accept.
    ref.editorView.setSelection(displayRange.start, displayRange.end)
    ref.insertText(insertText)
  }
  if (origin !== "autocomplete") {
    ref.replaceText(nextText)
  }
  queueMicrotask(() => {
    ref.editBuffer.setCursor(0, targetDisplayCol)
    ref.requestRender()
  })
  buffer.setNavColumn(targetDisplayCol)
  return true
}

function buildLineSplitEdit(
  buffer: BufferModel,
  lines: Line[],
  index: LineIndex,
  text: string,
  focusCol: DisplayColumn,
): LineEdit | undefined {
  const pieces = text.split("\n")
  const head = pieces[0] ?? ""
  const tail = pieces.slice(1)
  const current = lines[index]
  if (!current) {
    return undefined
  }

  const tailLines = tail.map((textSegment) => buffer._makeLine(textSegment, false))
  // reusing current line
  const headLine: Line = { ...current, text: head, rendered: false }
  const nextLines = [...lines]
  nextLines.splice(index, 1, headLine, ...tailLines)
  const focusRow = lineIndex(index + tail.length)
  return {
    nextLines,
    lineIdsToSync: [headLine.id],
    focusRow,
    focusCol,
  }
}

export function handleEnter(buffer: BufferModel, index: LineIndex) {
  const node = getLineRef(buffer, index)
  if (!node) {
    return
  }

  const cursor = node.logicalCursor
  const value = node.plainText
  const splitIndex = lineDisplayColumnToCharOffset(buffer, value, displayColumn(cursor.col))
  const before = value.slice(0, splitIndex)
  const after = value.slice(splitIndex)
  const current = buffer.lines()[index]
  if (!current) {
    return
  }

  const headLine: Line = { ...current, text: before, rendered: false }
  const tailLine: Line = buffer._makeLine(after, false)
  const nextLines = [...buffer.lines()]
  nextLines.splice(index, 1, headLine, tailLine)
  commitLineEdit(buffer, {
    nextLines,
    lineIdsToSync: [headLine.id],
    focusRow: lineIndex(index + 1),
    focusCol: displayColumn(0),
  })
}

export function handleBackwardMerge(buffer: BufferModel, index: LineIndex) {
  const prevIndex = lineIndex(index - 1)
  if (prevIndex < 0) {
    return
  }

  const prevLine = buffer.lines()[prevIndex]
  const current = buffer.lines()[index]
  if (!prevLine || !current) {
    return
  }

  const mergedLine: Line = { ...prevLine, text: prevLine.text + current.text, rendered: false }
  const nextLines = [...buffer.lines()]
  nextLines.splice(prevIndex, 2, mergedLine)
  commitLineEdit(buffer, {
    nextLines,
    lineIdsToSync: [mergedLine.id],
    focusRow: prevIndex,
    focusCol: lineCharOffsetToDisplayColumn(buffer, prevLine.text, lineCharOffset(prevLine.text.length)),
  })
}

export function handleForwardMerge(buffer: BufferModel, index: LineIndex) {
  const current = buffer.lines()[index]
  const nextLine = buffer.lines()[index + 1]
  if (!current || !nextLine) {
    return
  }

  const mergedLine: Line = { ...current, text: current.text + nextLine.text, rendered: false }
  const nextLines = [...buffer.lines()]
  nextLines.splice(index, 2, mergedLine)
  commitLineEdit(buffer, {
    nextLines,
    lineIdsToSync: [mergedLine.id],
    focusRow: index,
    focusCol: lineCharOffsetToDisplayColumn(buffer, current.text, lineCharOffset(current.text.length)),
  })
}

export function flush(buffer: BufferModel) {
  buffer._debouncedPush.clear()
  buffer.onTextChange(buffer.fullText(), { modified: buffer.contentModified() })
}

export function dispose(buffer: BufferModel) {
  buffer._debouncedPush.clear()
}
