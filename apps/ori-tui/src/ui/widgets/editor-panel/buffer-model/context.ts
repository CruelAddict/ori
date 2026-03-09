import { buildLineStarts } from "@utils/line-offsets"
import { createMemo } from "solid-js"
import { collectSqlStatements } from "../sql-statement-detector"
import { type Line, toDisplayColumn } from "./lines"
import { type BufferModelOptions, createBufferState } from "./state"

// BufferContext holds current buffer state and memoed state inferred from it
export function createBufferContext(options: BufferModelOptions) {
  const state = createBufferState(options)
  const lines = () => state.document.lines
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
    return statements().find(
      (stmt) => stmt.startLine <= state.session.focusedRow() && stmt.endLine >= state.session.focusedRow(),
    )
  })

  const getLineDisplayWidth = (index: number): number => {
    const text = lines()[index]?.text ?? ""
    return toDisplayColumn(text, text.length)
  }

  const setLines = (lines: Line[]) => {
    state.setDocument("lines", lines)
  }

  const setLine = (index: number, line: Line) => {
    state.setDocument("lines", index, line)
  }

  return {
    state,
    lines,
    lineIds,
    linesById,
    fullText,
    lineStarts,
    statements,
    statementAtCursor,
    getLineDisplayWidth,
    setLines,
    setLine,
  }
}

export type BufferContext = ReturnType<typeof createBufferContext>
