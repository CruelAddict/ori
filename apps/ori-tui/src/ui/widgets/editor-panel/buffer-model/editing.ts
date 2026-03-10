import { reapplyLineHighlight } from "./highlighting"
import { displayColumnToCharIndex, getTabWidth, type Line, makeLine, makeLinesFromText, toDisplayColumn } from "./lines"
import type { BufferModel } from "./model"
import { clampFocus, deleteStaleRefs, getLineRef, moveFocus } from "./navigation"

type LineEdit = {
  nextLines: Line[]
  lineIdsToSync: string[]
  focusRow: number
  focusCol: number
}

function schedulePush(buffer: BufferModel) {
  buffer.requestHighlights()
  buffer.debouncedPush()
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

      const ref = buffer.lineRefs.get(id)
      if (!ref) {
        continue
      }

      if (ref.plainText !== line.text) {
        ref.setText(line.text)
        reapplyLineHighlight(buffer, id)
      }

      buffer.setContentModified(true)
      schedulePush(buffer)
    }
  })
}

function commitLineEdit(buffer: BufferModel, edit: LineEdit | undefined) {
  if (!edit) {
    return
  }

  buffer.setLines(edit.nextLines)
  deleteStaleRefs(buffer, edit.nextLines)
  buffer.setContentModified(true)
  schedulePush(buffer)
  syncRefTextWithDocumentState(buffer, edit.nextLines, edit.lineIdsToSync)
  moveFocus(buffer, edit.focusRow, edit.focusCol)
}

export function setText(buffer: BufferModel, text: string) {
  const nextLines = makeLinesFromText(text, false)
  buffer.setLines(nextLines)
  buffer.setContentModified(false)
  deleteStaleRefs(buffer, nextLines)
  clampFocus(buffer, nextLines)
  schedulePush(buffer)
}

export function handleTextAreaChange(buffer: BufferModel, index: number) {
  const node = getLineRef(buffer, index)
  const line = buffer.lines()[index]
  if (!node || !line) {
    return
  }

  const text = node.plainText
  if (!line.rendered) {
    buffer.setLine(index, { ...line, text, rendered: true })
    return
  }
  if (text === line.text) {
    return
  }
  if (text.includes("\n")) {
    commitLineEdit(buffer, buildLineSplitEdit(buffer.lines(), index, text))
    return
  }

  buffer.setLine(index, { ...line, text, rendered: true })
  buffer.setContentModified(true)
  schedulePush(buffer)
}

function buildLineSplitEdit(lines: Line[], index: number, text: string): LineEdit | undefined {
  const pieces = text.split("\n")
  const head = pieces[0] ?? ""
  const tail = pieces.slice(1)
  const current = lines[index]
  if (!current) {
    return undefined
  }

  const tailLines = tail.map((textSegment) => makeLine(textSegment, false))
  // reusing current line
  const headLine: Line = { ...current, text: head, rendered: false }
  const nextLines = [...lines]
  nextLines.splice(index, 1, headLine, ...tailLines)
  const focusRow = index + tail.length
  return {
    nextLines,
    lineIdsToSync: [headLine.id],
    focusRow,
    focusCol: toDisplayColumn(nextLines[focusRow]?.text ?? "", (nextLines[focusRow]?.text ?? "").length),
  }
}

export function handleEnter(buffer: BufferModel, index: number) {
  const node = getLineRef(buffer, index)
  if (!node) {
    return
  }

  const cursor = node.logicalCursor
  const value = node.plainText
  const splitIndex = displayColumnToCharIndex(value, cursor.col, getTabWidth(node))
  const before = value.slice(0, splitIndex)
  const after = value.slice(splitIndex)
  const current = buffer.lines()[index]
  if (!current) {
    return
  }

  const headLine: Line = { ...current, text: before, rendered: false }
  const tailLine: Line = makeLine(after, false)
  const nextLines = [...buffer.lines()]
  nextLines.splice(index, 1, headLine, tailLine)
  commitLineEdit(buffer, {
    nextLines,
    lineIdsToSync: [headLine.id],
    focusRow: index + 1,
    focusCol: 0,
  })
}

export function handleBackwardMerge(buffer: BufferModel, index: number) {
  const prevIndex = index - 1
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
    focusCol: toDisplayColumn(prevLine.text, prevLine.text.length),
  })
}

export function handleForwardMerge(buffer: BufferModel, index: number) {
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
    focusCol: toDisplayColumn(current.text, current.text.length),
  })
}

export function flush(buffer: BufferModel) {
  buffer.debouncedPush.clear()
  buffer.onTextChange(buffer.fullText(), { modified: buffer.contentModified() })
}

export function dispose(buffer: BufferModel) {
  buffer.debouncedPush.clear()
}
