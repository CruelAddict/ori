import type { SyntaxStyle, TextareaRenderable } from "@opentui/core"
import type { Accessor } from "solid-js"

export type AnalysisHost = {
  tabWidth: number
  getRef: () => TextareaRenderable | undefined
  getText: () => string
  getLineStarts: () => number[]
  getVersion: () => number
  getFocusedRow: () => number
  requestSync: () => void
}

export type AnalysisSession = {
  rebuild: (text: string, lineStarts: number[], version: number) => void
  reset: () => void
  invalidate: () => void
  sync: () => void
  dispose: () => void
}

export type BufferAnalysis = {
  syntaxStyle: Accessor<SyntaxStyle>
  createSession: (host: AnalysisHost) => AnalysisSession
}
