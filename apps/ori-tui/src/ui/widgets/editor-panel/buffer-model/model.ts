import type { TextareaRenderable } from "@opentui/core"
import { debounce } from "@utils/debounce"
import { buildLineStarts } from "@utils/line-offsets"
import type { SyntaxHighlightResult } from "@utils/syntax-highlighter"
import { type Accessor, createMemo, createSignal, type Setter } from "solid-js"
import { createStore } from "solid-js/store"
import { collectSqlStatements, type SqlStatement } from "../sql-statement-detector"
import * as edit from "./editing"
import * as hl from "./highlighting"
import { type Line, makeLinesFromText, toDisplayColumn } from "./lines"
import * as nav from "./navigation"

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

export type BufferModel = {
  isFocused: Accessor<boolean>
  onTextChange: (text: string, info: { modified: boolean }) => void
  scheduleHighlight: (text: string, version: number | string) => void
  highlightResult: Accessor<SyntaxHighlightResult>
  contentModified: Accessor<boolean>
  setContentModified: Setter<boolean>
  lines: Accessor<Line[]>
  lineIds: Accessor<string[]>
  linesById: Accessor<Map<string, Line>>
  fullText: Accessor<string>
  lineStarts: Accessor<number[]>
  statements: Accessor<SqlStatement[]>
  statementAtCursor: Accessor<SqlStatement | undefined>
  lineRefs: Map<string, TextareaRenderable | undefined>
  highlightRequestVersion: number
  debouncedPush: ReturnType<typeof debounce>
  focusedRow: Accessor<number>
  navColumn: Accessor<number>
  getLineDisplayWidth: (index: number) => number
  setLines: (lines: Line[]) => void
  setLine: (index: number, line: Line) => void
  requestHighlights: () => void
  setLineRef: (lineId: string, ref: TextareaRenderable | undefined) => void
  getLineRef: (index: number) => TextareaRenderable | undefined
  getVisualEOLColumn: (index: number) => number
  setFocusedRow: Setter<number>
  setNavColumn: Setter<number>
  setText: (text: string) => void
  focusCurrent: () => void
  handleFocusChange: (isFocused: boolean) => void
  handleTextAreaChange: (index: number) => void
  getCursorContext: () => CursorContext | undefined
  handleEnter: (index: number) => void
  handleBackwardMerge: (index: number) => void
  handleForwardMerge: (index: number) => void
  handleVerticalMove: (index: number, delta: -1 | 1) => void
  moveCursorByVisualRows: (delta: number) => number
  handleHorizontalJump: (index: number, toPrevious: boolean) => void
  clampFocus: (lines?: Line[]) => void
  flush: () => void
  dispose: () => void
}

export function createBufferModel(options: BufferModelOptions): BufferModel {
  const [document, setDocument] = createStore({
    lines: makeLinesFromText(options.initialText, true),
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
  const statementAtCursor = createMemo(() => {
    return statements().find((stmt) => stmt.startLine <= focusedRow() && stmt.endLine >= focusedRow())
  })

  const getLineDisplayWidth = (index: number) => {
    const text = lines()[index]?.text ?? ""
    return toDisplayColumn(text, text.length)
  }

  const buffer: BufferModel = {
    isFocused: options.isFocused,
    onTextChange: options.onTextChange,
    scheduleHighlight: options.scheduleHighlight,
    highlightResult: options.highlightResult,
    contentModified,
    setContentModified,
    lines,
    lineIds,
    linesById,
    fullText,
    lineStarts,
    statements,
    statementAtCursor,
    lineRefs: new Map<string, TextareaRenderable | undefined>(),
    highlightRequestVersion: 0,
    debouncedPush: debounce(() => {
      const text = document.lines.map((line) => line.text).join("\n")
      options.onTextChange(text, { modified: contentModified() })
    }, options.debounceMs ?? DEBOUNCE_DEFAULT_MS),
    focusedRow,
    navColumn,
    getLineDisplayWidth,
    setLines: (nextLines) => {
      setDocument("lines", nextLines)
    },
    setLine: (index, line) => {
      setDocument("lines", index, line)
    },
    requestHighlights: () => hl.requestHighlights(buffer),
    setLineRef: (lineId, ref) => nav.setLineRef(buffer, lineId, ref),
    getLineRef: (index) => nav.getLineRef(buffer, index),
    getVisualEOLColumn: (index) => nav.getVisualEOLColumn(buffer, index),
    setFocusedRow,
    setNavColumn,
    setText: (text) => edit.setText(buffer, text),
    focusCurrent: () => nav.focusCurrent(buffer),
    handleFocusChange: (isFocusedNow) => nav.handleFocusChange(buffer, isFocusedNow),
    handleTextAreaChange: (index) => edit.handleTextAreaChange(buffer, index),
    getCursorContext: () => nav.getCursorContext(buffer),
    handleEnter: (index) => edit.handleEnter(buffer, index),
    handleBackwardMerge: (index) => edit.handleBackwardMerge(buffer, index),
    handleForwardMerge: (index) => edit.handleForwardMerge(buffer, index),
    handleVerticalMove: (index, delta) => nav.handleVerticalMove(buffer, index, delta),
    moveCursorByVisualRows: (delta) => nav.moveCursorByVisualRows(buffer, delta),
    handleHorizontalJump: (index, toPrevious) => nav.handleHorizontalJump(buffer, index, toPrevious),
    clampFocus: (nextLines = buffer.lines()) => nav.clampFocus(buffer, nextLines),
    flush: () => edit.flush(buffer),
    dispose: () => edit.dispose(buffer),
  }

  hl.mountHighlighting(buffer)
  buffer.requestHighlights()

  return buffer
}
