import type { LineInfo, SyntaxStyle, TextareaRenderable } from "@opentui/core"
import type { SyntaxHighlightSpan } from "@utils/syntax-highlighter"
import type { Accessor } from "solid-js"

export type BufferTextChange = {
  start: number
  previousEnd: number
  nextEnd: number
}

export type BufferAnalysisRange = {
  start: number
  end: number
  startLine: number
  endLine: number
}

export type BufferAnalysisEntry = BufferAnalysisRange & {
  id: string
  spans: SyntaxHighlightSpan[]
  dirty: boolean
  highlightVersion: number
}

export type BufferAnalysisSnapshot = {
  version: number | string
  entries: readonly BufferAnalysisEntry[]
  lineToEntry: readonly number[]
}

export type AnalysisHost = {
  tabWidth: number
  getRef: () => TextareaRenderable | undefined
  getLineInfo: (ref: TextareaRenderable) => LineInfo
  getText: () => string
  getLineStarts: () => number[]
  getVersion: () => number
  getFocusedRow: () => number
  requestSync: () => void
}

export type AnalysisSession = {
  rebuild: (text: string, lineStarts: number[], version: number, change?: BufferTextChange) => void
  reset: () => void
  invalidate: () => void
  sync: (options?: { scheduleUpdate?: boolean }) => void
  dispose: () => void
}

export type BufferAnalysis = {
  languageId?: string
  syntaxStyle: Accessor<SyntaxStyle>
  collectRanges?: (text: string, lineStarts: readonly number[]) => BufferAnalysisRange[]
  highlightText?: (text: string) => Promise<SyntaxHighlightSpan[]>
  onSnapshotChange?: (snapshot: BufferAnalysisSnapshot | undefined, lineCount: number) => void
  createSession: (host: AnalysisHost) => AnalysisSession
}
