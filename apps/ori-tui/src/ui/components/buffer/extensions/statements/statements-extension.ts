import type { DocCharOffset, LineIndex } from "../../coords"
import type { Document } from "../../document"
import type { BufferExtension } from "../../extension"
import type { ViewportSnapshot } from "../../viewport-snapshot"
import { createStatementStore } from "./statement-store"
import type { StatementSnapshot } from "./statement-types"

export type BufferStatementRange = {
  start: DocCharOffset
  end: DocCharOffset
  startLine: LineIndex
  endLine: LineIndex
}

export type BufferStatementEntry = BufferStatementRange & {
  id: string
}

export type BufferStatementSnapshot = {
  version: Document["version"] | string
  entries: readonly BufferStatementEntry[]
  lineToStatements: readonly number[][]
}

export type BufferStatementDetector = {
  id: string
  detect: (text: string, lineStarts: readonly DocCharOffset[]) => BufferStatementRange[]
  onSnapshotChange?: (snapshot: BufferStatementSnapshot | undefined, lineCount: number) => void
}

export type StatementSource = {
  read: () => StatementSnapshot | undefined
  collectVisibleIndices: (viewport: ViewportSnapshot, overscan: number) => number[]
}

export function createStatementsExtension(detector: BufferStatementDetector): {
  extension: BufferExtension
  source: StatementSource
} {
  let statementId = 0
  const nextStatementId = () => {
    const id = `statement-${statementId}`
    statementId += 1
    return id
  }
  const store = createStatementStore({ collectStatements: detector.detect, nextId: nextStatementId })

  const refreshSnapshot = (snapshot: StatementSnapshot | undefined, lineCount: number) => {
    detector.onSnapshotChange?.(
      snapshot
        ? {
            version: snapshot.version,
            entries: snapshot.entries,
            lineToStatements: snapshot.lineToStatements,
          }
        : undefined,
      lineCount,
    )
  }

  const source: StatementSource = {
    read: store.read,
    collectVisibleIndices: store.collectVisibleIndices,
  }

  return {
    source,
    extension: {
      id: detector.id,
      setup: (host) => {
        return host.onDocumentChange(({ document, change, reason }) => {
          if (reason === "replace") {
            store.reset()
          }
          const snapshot = store.update(document, change)
          refreshSnapshot(snapshot, document.lineStarts.length)
        })
      },
    },
  }
}
