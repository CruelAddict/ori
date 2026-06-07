import type { DocCharOffset, DocumentVersion, LineIndex } from "../../coords"

export type StatementRange = {
  start: DocCharOffset
  end: DocCharOffset
  startLine: LineIndex
  endLine: LineIndex
}

export type CollectStatements = (text: string, lineStarts: readonly DocCharOffset[]) => StatementRange[]

export type StatementEntry = StatementRange & {
  /**
   * Stable identity of the same statement across document edits. Offsets and
   * lines may shift, but the id is preserved while an old statement can be
   * matched to a new collected range.
   */
  id: string
}

export type StatementSnapshot = {
  version: DocumentVersion | string
  entries: StatementEntry[]
  lineToStatements: number[][]
}
