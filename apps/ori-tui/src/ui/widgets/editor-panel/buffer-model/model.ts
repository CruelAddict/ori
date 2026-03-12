import type { SyntaxStyle, TextareaRenderable, WidthMethod } from "@opentui/core"
import { debounce } from "@utils/debounce"
import { buildLineStarts } from "@utils/line-offsets"
import type { SyntaxHighlightResult } from "@utils/syntax-highlighter"
import { type Accessor, createMemo, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { collectSqlStatements } from "../sql-statement-detector"
import * as edit from "./editing"
import * as hl from "./highlighting"
import * as nav from "./navigation"
import { toDisplayColumn } from "./text-metrics"

const DEBOUNCE_DEFAULT_MS = 20

export type BufferModelOptions = {
  initialText: string
  isFocused: Accessor<boolean>
  onTextChange: (text: string, info: { modified: boolean }) => void
  debounceMs?: number
  scheduleHighlight: (text: string, version: number | string) => void
  highlightResult: Accessor<SyntaxHighlightResult>
}

export type CursorContext = {
  index: number
  cursorCol: number
  cursorRow: number
}

export type Line = {
  id: string
  text: string
  rendered: boolean
}

function makeLine(id: string, text: string, rendered: boolean): Line {
  return { id, text, rendered }
}

function makeLinesFromText(text: string, rendered: boolean, nextId: () => string): Line[] {
  const parts = text.split("\n")
  const safeParts = parts.length > 0 ? parts : [""]
  return safeParts.map((part) => makeLine(nextId(), part, rendered))
}

export function createBufferModel(options: BufferModelOptions) {
  const [document, setDocument] = createStore({
    lines: [] as Line[],
  })
  const [contentModified, setContentModified] = createSignal(false)
  const [focusedRow, setFocusedRow] = createSignal(0)
  const [navColumn, setNavColumn] = createSignal(0)
  const lines = () => document.lines
  const lineIds = createMemo(() => lines().map((entry) => entry.id))
  const linesById = createMemo(() => new Map(lines().map((entry) => [entry.id, entry])))
  const fullText = createMemo(() =>
    lines()
      .map((entry) => entry.text)
      .join("\n"),
  )
  const lineStarts = createMemo(() => buildLineStarts(fullText()))
  const statements = createMemo(() => collectSqlStatements(fullText(), lineStarts()))
  const statementAtCursor = createMemo(() =>
    statements().find((stmt) => stmt.startLine <= focusedRow() && stmt.endLine >= focusedRow()),
  )

  const nextLineId = () => {
    const id = `line-${buffer._nextLineId}`
    buffer._nextLineId += 1
    return id
  }

  const buffer = {
    // External hooks
    isFocused: options.isFocused,
    onTextChange: options.onTextChange,
    scheduleHighlight: options.scheduleHighlight,
    highlightResult: options.highlightResult,

    // External resources
    setLineRef: (lineId: string, ref: TextareaRenderable | undefined) => nav.setLineRef(buffer, lineId, ref),
    getLineRef: (index: number) => nav.getLineRef(buffer, index),

    // Memoed queries
    lines,
    lineIds,
    linesById,
    fullText,
    lineStarts,
    statements,
    statementAtCursor,

    // Editing
    contentModified,
    setContentModified,
    setText: (text: string) => edit.setText(buffer, text),
    handleTextAreaChange: (index: number) => edit.handleTextAreaChange(buffer, index),
    handleEnter: (index: number) => edit.handleEnter(buffer, index),
    handleBackwardMerge: (index: number) => edit.handleBackwardMerge(buffer, index),
    handleForwardMerge: (index: number) => edit.handleForwardMerge(buffer, index),
    flush: () => edit.flush(buffer),
    dispose: () => edit.dispose(buffer),

    // Navigation and focus.
    focusedRow,
    setFocusedRow,
    navColumn,
    setNavColumn,
    getVisualEOLColumn: (index: number) => nav.getVisualEOLColumn(buffer, index),
    getCursorContext: () => nav.getCursorContext(buffer),
    handleFocusChange: (isFocusedNow: boolean) => nav.handleFocusChange(buffer, isFocusedNow),
    focusCurrent: () => nav.focusCurrent(buffer),
    handleVerticalMove: (index: number, delta: -1 | 1) => nav.handleVerticalMove(buffer, index, delta),
    moveCursorByVisualRows: (delta: number) => nav.moveCursorByVisualRows(buffer, delta),
    handleHorizontalJump: (index: number, toPrevious: boolean) => nav.handleHorizontalJump(buffer, index, toPrevious),
    clampFocus: (nextLines: Line[] = buffer.lines()) => nav.clampFocus(buffer, nextLines),

    _lineRefs: new Map<string, TextareaRenderable | undefined>(),
    _lineHighlightSpans: new Map<string, hl.LineSpan[]>(),
    _highlightRequestVersion: 0,
    _syntaxStyle: undefined as SyntaxStyle | undefined,
    _widthMethod: undefined as WidthMethod | undefined,
    _nextLineId: 0,

    _debouncedPush: debounce(() => {
      const text = document.lines.map((line) => line.text).join("\n")
      options.onTextChange(text, { modified: contentModified() })
    }, options.debounceMs ?? DEBOUNCE_DEFAULT_MS),
    _makeLine: (text: string, rendered: boolean) => makeLine(nextLineId(), text, rendered),
    _makeLinesFromText: (text: string, rendered: boolean) => makeLinesFromText(text, rendered, nextLineId),
    _getLineDisplayWidth: (index: number) => {
      const text = lines()[index]?.text ?? ""
      return toDisplayColumn(text, text.length, buffer._widthMethod)
    },
    _setLines: (nextLines: Line[]) => setDocument("lines", nextLines),
    _setLine: (index: number, line: Line) => setDocument("lines", index, line),
    _requestHighlights: () => hl.requestHighlights(buffer),
    _reapplyLineHighlight: (lineId: string) => hl.reapplyLineHighlight(buffer, lineId),
  }

  buffer._setLines(buffer._makeLinesFromText(options.initialText, true))
  hl.mountHighlighting(buffer)
  buffer._requestHighlights()

  return buffer
}

export type BufferModel = ReturnType<typeof createBufferModel>
