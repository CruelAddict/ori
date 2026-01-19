import { resolveRenderLib, type TextareaRenderable, type WidthMethod } from "@opentui/core"
import { debounce } from "@shared/lib/debounce"
import type { Logger } from "pino"
import { type Accessor, createEffect, createSignal, on } from "solid-js"
import { createStore } from "solid-js/store"
import type { SyntaxHighlightResult } from "../../features/syntax-highlighting/syntax-highlighter"
import { applySyntaxHighlights } from "./sql-highlighter"

const DEBOUNCE_DEFAULT_MS = 20
let cachedWidthMethod: WidthMethod | undefined

function extractWidthMethod(ref: TextareaRenderable | undefined): void {
  if (ref?.ctx?.widthMethod) {
    cachedWidthMethod = ref.ctx.widthMethod
  }
}

function widthMethod(): WidthMethod {
  return cachedWidthMethod ?? "unicode"
}


function toDisplayColumn(text: string, column: number): number {
  if (column <= 0) {
    return 0
  }
  const end = Math.min(column, text.length)
  const prefix = text.slice(0, end)
  if (!prefix) {
    return 0
  }
  const renderLib = resolveRenderLib()
  const encoded = renderLib.encodeUnicode(prefix, widthMethod())
  if (!encoded) {
    return 0
  }
  let width = 0
  for (const entry of encoded.data) {
    width += entry.width
  }
  renderLib.freeUnicode(encoded)
  return width
}

function lineDisplayWidth(text: string): number {
  return toDisplayColumn(text, text.length)
}

export type CursorContext = {
  index: number
  cursorCol: number
  cursorRow: number
  text: string
}

export type Line = {
  id: string
  text: string
  rendered: boolean
}

export type BufferState = {
  lines: Line[]
  contentModified: boolean
}

export type BufferModelOptions = {
  initialText: string
  isFocused: Accessor<boolean>
  onTextChange: (text: string, info: { modified: boolean }) => void
  debounceMs?: number
  scheduleHighlight: (text: string, version: number | string) => void
  highlightResult: Accessor<SyntaxHighlightResult>
  logger: Logger
}

let lineIdCounter = 0
const nextLineId = () => `line-${lineIdCounter++}`

function makeLine(text: string, rendered: boolean): Line {
  return { id: nextLineId(), text, rendered }
}

function makeLinesFromText(text: string, rendered: boolean): Line[] {
  const parts = text.split("\n")
  const safeParts = parts.length > 0 ? parts : [""]
  return safeParts.map((part) => makeLine(part, rendered))
}

export function buildLineStarts(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      starts.push(i + 1)
    }
  }
  return starts
}

function offsetToLineCol(offset: number, lineStarts: number[]): { line: number; col: number } {
  let low = 0
  let high = lineStarts.length - 1
  while (low <= high) {
    const mid = (low + high) >> 1
    const start = lineStarts[mid]
    const nextStart = mid + 1 < lineStarts.length ? lineStarts[mid + 1] : Number.POSITIVE_INFINITY
    if (offset < start) {
      high = mid - 1
    } else if (offset >= nextStart) {
      low = mid + 1
    } else {
      return { line: mid, col: offset - start }
    }
  }
  return { line: lineStarts.length - 1, col: 0 }
}

export function createBufferModel(options: BufferModelOptions) {
  const [state, setState] = createStore<BufferState>({
    lines: makeLinesFromText(options.initialText, true),
    contentModified: false,
  })
  const [focusedRow, setFocusedRow] = createSignal(0)
  const [navColumn, setNavColumn] = createSignal(0)

  const lineRefs = new Map<string, TextareaRenderable | undefined>()
  let highlightRequestVersion = 0

  const requestHighlights = () => {
    const text = state.lines.map((line) => line.text).join("\n")
    const nextVersion = ++highlightRequestVersion
    options.scheduleHighlight(text, nextVersion)
  }

  const buildHighlightSpansByLine = (highlight: SyntaxHighlightResult) => {
    const text = state.lines.map((line) => line.text).join("\n")
    const lineStarts = buildLineStarts(text)
    const highlightSpansByLine = new Map<number, { start: number; end: number; styleId: number }[]>()

    for (const span of highlight.spans) {
      const start = offsetToLineCol(span.start, lineStarts)
      const end = offsetToLineCol(span.end, lineStarts)
      if (start.line !== end.line) {
        continue
      }
      const lineText = state.lines[start.line]?.text ?? ""
      const spans = highlightSpansByLine.get(start.line) ?? []
      spans.push({
        start: toDisplayColumn(lineText, start.col),
        end: toDisplayColumn(lineText, end.col),
        styleId: span.styleId,
      })
      highlightSpansByLine.set(start.line, spans)
    }

    for (const spans of highlightSpansByLine.values()) {
      spans.sort((a, b) => a.start - b.start || a.end - b.end)
    }

    return highlightSpansByLine
  }

  const setLineRef = (lineId: string, ref: TextareaRenderable | undefined) => {
    if (!ref) {
      lineRefs.delete(lineId)
      return
    }
    lineRefs.set(lineId, ref)
    if (!cachedWidthMethod) {
      extractWidthMethod(ref)
      requestHighlights()
    }
  }

  const getLineRef = (index: number) => {
    const line = state.lines[index]
    if (!line) {
      return undefined
    }
    return lineRefs.get(line.id)
  }

  createEffect(
    on(options.highlightResult, (highlight) => {
      if (highlight.version !== highlightRequestVersion) {
        return
      }
      const spansByLine = buildHighlightSpansByLine(highlight)
      applySyntaxHighlights({
        spansByLine,
        syntaxStyle: highlight.syntaxStyle,
        lineCount: state.lines.length,
        getLineRef: getLineRef,
      })
    }),
  )

  const syncRefsWithLines = (lines: Line[]) => {
    const ids = new Set(lines.map((line) => line.id))
    for (const id of lineRefs.keys()) {
      if (!ids.has(id)) {
        lineRefs.delete(id)
      }
    }
  }

  const getLineText = (index: number): string => {
    const line = state.lines[index]
    if (!line) {
      return ""
    }
    return line.text
  }

  const getLineDisplayWidth = (index: number): number => {
    const ref = getLineRef(index)
    if (ref) {
      return ref.editorView.getVisualEOL().logicalCol
    }
    return lineDisplayWidth(getLineText(index))
  }

  const emitPush = () => {
    const lines = state.lines.map((_, i) => getLineText(i))
    const text = lines.join("\n")
    options.onTextChange(text, { modified: state.contentModified })
  }

  const debouncedPush = debounce(() => {
    emitPush()
  }, options.debounceMs ?? DEBOUNCE_DEFAULT_MS)

  const schedulePush = () => {
    requestHighlights()
    debouncedPush()
  }

  // Seed initial highlight computation for the starting text
  requestHighlights()

  const flush = () => {
    debouncedPush.clear()
    emitPush()
  }

  const focusLine = (index: number, column: number) => {
    const node = getLineRef(index)
    if (!node) {
      return
    }
    if (!options.isFocused()) {
      return
    }
    node.focus()
    const targetCol = Math.min(column, getLineDisplayWidth(index))
    node.editBuffer.setCursorToLineCol(0, targetCol)
    setFocusedRow(index)
  }

  const clampFocus = (lines: Line[] = state.lines) => {
    const targetRow = Math.min(focusedRow(), Math.max(0, lines.length - 1))
    const targetCol = Math.min(navColumn(), getLineDisplayWidth(targetRow))
    setFocusedRow(targetRow)
    setNavColumn(targetCol)
    queueMicrotask(() => focusLine(targetRow, targetCol))
  }

  const setText = (text: string) => {
    const nextLines = makeLinesFromText(text, false)
    setState({ lines: nextLines, contentModified: false })
    syncRefsWithLines(nextLines)
    clampFocus(nextLines)
    schedulePush()
  }

  const focusCurrent = () => {
    focusLine(focusedRow(), navColumn())
  }

  const handleFocusChange = (isFocused: boolean) => {
    const target = getLineRef(focusedRow())
    if (!target) {
      return
    }
    if (!isFocused) {
      target.blur()
      return
    }
    focusLine(focusedRow(), navColumn())
  }

  const getCursorContext = (): CursorContext | undefined => {
    const index = focusedRow()
    const node = getLineRef(index)
    if (!node) {
      return undefined
    }
    const cursor = node.logicalCursor
    const text = getLineText(index)
    return { index, cursorCol: cursor.col, cursorRow: cursor.row, text }
  }

  const setRenderedLine = (index: number, text: string, line: Line) => {
    setState("lines", index, { ...line, text, rendered: true })
  }

  const handleMultilineChange = (index: number, _line: Line, text: string) => {
    const pieces = text.split("\n")
    const head = pieces[0] ?? ""
    const tail = pieces.slice(1)
    const tailLines = tail.map((segment) => makeLine(segment, false))
    setState("lines", (prev) => {
      const next = [...prev]
      const current = next[index]
      if (!current) {
        return prev
      }
      const headLine: Line = { ...current, text: head, rendered: false }
      next.splice(index, 1, headLine, ...tailLines)
      return next
    })
    syncRefsWithLines(state.lines)
    setState("contentModified", true)
    const targetIndex = index + tail.length
    const targetCol = getLineDisplayWidth(targetIndex)
    setFocusedRow(targetIndex)
    setNavColumn(targetCol)
    schedulePush()
    queueMicrotask(() => focusLine(targetIndex, targetCol))
  }

  const applyRenderedText = (index: number, line: Line, text: string) => {
    setState("lines", index, { ...line, text, rendered: true })
    setState("contentModified", true)
    schedulePush()
  }

  const handleTextAreaChange = (index: number) => {
    const node = getLineRef(index)
    const line = state.lines[index]
    if (!node || !line) {
      return
    }

    const text = node.plainText

    if (!line.rendered) {
      setRenderedLine(index, text, line)
      return
    }

    if (text === line.text) {
      return
    }

    if (text.includes("\n")) {
      handleMultilineChange(index, line, text)
      return
    }

    applyRenderedText(index, line, text)
  }

  const handleEnter = (index: number) => {
    const node = getLineRef(index)
    if (!node) {
      return
    }
    const cursor = node.logicalCursor
    const value = getLineText(index)
    const before = value.slice(0, cursor.col)
    const after = value.slice(cursor.col)
    const nextIndex = index + 1
    const tailLine = makeLine(after, false)
    setState("lines", (prev) => {
      const next = [...prev]
      const current = next[index]
      if (!current) {
        return prev
      }
      const headLine: Line = { ...current, text: before, rendered: false }
      next.splice(index, 1, headLine, tailLine)
      return next
    })
    syncRefsWithLines(state.lines)
    setState("contentModified", true)
    setFocusedRow(nextIndex)
    setNavColumn(0)
    schedulePush()
    queueMicrotask(() => focusLine(nextIndex, 0))
  }

  const handleBackwardMerge = (index: number) => {
    const prevIndex = index - 1
    if (prevIndex < 0) {
      return
    }
    const currentText = getLineText(index)
    const prevText = getLineText(prevIndex)
    setState("lines", (prev) => {
      const next = [...prev]
      const prevLine = next[prevIndex]
      if (!prevLine) {
        return prev
      }
      const mergedLine: Line = { ...prevLine, text: prevText + currentText, rendered: false }
      next.splice(prevIndex, 2, mergedLine)
      return next
    })
    syncRefsWithLines(state.lines)
    setState("contentModified", true)
    const newCol = getLineDisplayWidth(prevIndex)
    setFocusedRow(prevIndex)
    setNavColumn(newCol)
    schedulePush()
    queueMicrotask(() => focusLine(prevIndex, newCol))
  }

  const handleForwardMerge = (index: number) => {
    const nextIndex = index + 1
    const nextLine = state.lines[nextIndex]
    if (nextLine === undefined) {
      return
    }
    const currentText = getLineText(index)
    const followingText = getLineText(nextIndex)
    setState("lines", (prev) => {
      const next = [...prev]
      const currentLine = next[index]
      if (!currentLine) {
        return prev
      }
      const mergedLine: Line = { ...currentLine, text: currentText + followingText, rendered: false }
      next.splice(index, 2, mergedLine)
      return next
    })
    syncRefsWithLines(state.lines)
    setState("contentModified", true)
    const newCol = getLineDisplayWidth(index)
    setFocusedRow(index)
    setNavColumn(newCol)
    schedulePush()
    queueMicrotask(() => focusLine(index, newCol))
  }

  const handleVerticalMove = (index: number, delta: -1 | 1) => {
    const targetIndex = index + delta
    const targetLine = state.lines[targetIndex]
    if (targetLine === undefined) {
      return
    }
    const targetCol = Math.min(navColumn(), getLineDisplayWidth(targetIndex))
    setFocusedRow(targetIndex)
    setNavColumn(targetCol)
    queueMicrotask(() => focusLine(targetIndex, targetCol))
  }

  const handleHorizontalJump = (index: number, toPrevious: boolean) => {
    if (toPrevious) {
      const targetIndex = index - 1
      if (targetIndex < 0) {
        return
      }
      const targetCol = getLineDisplayWidth(targetIndex)
      setNavColumn(targetCol)
      setFocusedRow(targetIndex)
      queueMicrotask(() => focusLine(targetIndex, targetCol))
      return
    }
    const targetIndex = index + 1
    const targetText = state.lines[targetIndex]
    if (targetText === undefined) {
      return
    }
    setNavColumn(0)
    setFocusedRow(targetIndex)
    queueMicrotask(() => focusLine(targetIndex, 0))
  }

  const dispose = () => {
    debouncedPush.clear()
  }

  return {
    lines: () => state.lines,
    focusedRow,
    navColumn,
    setLineRef,
    getLineRef,
    setFocusedRow,
    setNavColumn,
    setText,
    focusCurrent,
    handleFocusChange,
    handleTextAreaChange,
    getCursorContext,
    handleEnter,
    handleBackwardMerge,
    handleForwardMerge,
    handleVerticalMove,
    handleHorizontalJump,
    clampFocus,
    flush,
    dispose,
  }
}

export type BufferModel = ReturnType<typeof createBufferModel>
