import type { BufferAnalysis } from "@ui/components/buffer/analysis"
import {
  addStatementHighlightSpanLines,
  applyStatementBatch,
  buildStatementBatch,
  buildStatementCache,
  collectVisibleStatementIndices,
  collectVisibleStatements,
  hasDirtyStatements,
  type StatementCache,
  type StatementEntry,
} from "@ui/components/buffer/buffer-statement-cache"
import { offsetToLineCol } from "@utils/line-offsets"
import { syntaxHighlighter } from "@utils/syntax-highlighter"
import type { Logger } from "pino"
import { type Accessor, createSignal } from "solid-js"

const VISIBLE_OVERSCAN_ROWS = 8
const WARM_OVERSCAN_ROWS = 24
const HIGHLIGHT_BACKFILL_QUIET_MS = 180
const HIGHLIGHT_BACKFILL_BATCH_STATEMENTS = 64
const HIGHLIGHT_BACKFILL_BATCH_CHARS = 24_000

export type SqlQuery = {
  id: string
  start: number
  end: number
  startLine: number
  endLine: number
}

export type SqlQueryResolution = { kind: "query"; query: SqlQuery } | { kind: "ambiguous" } | { kind: "none" }

export type SqlAnalysisSnapshot = {
  queries: SqlQuery[]
  queryStartLineByLine: number[]
}

type SyntaxThemePalette = {
  get(group: string): string
}

type MaterializedHighlightEntry = {
  highlightGroupId: number
  version: number
}

function mapQuery(statement: SqlQuery | StatementEntry): SqlQuery {
  return {
    id: statement.id,
    start: statement.start,
    end: statement.end,
    startLine: statement.startLine,
    endLine: statement.endLine,
  }
}

function buildQueryStartLineByLine(queries: readonly SqlQuery[], lineCount: number) {
  const lines = Array.from({ length: lineCount }, () => -1)

  for (const query of queries) {
    for (let line = query.startLine; line <= query.endLine; line += 1) {
      const current = lines[line]
      if (current === -1) {
        lines[line] = query.startLine
        continue
      }
      if (current === query.startLine) {
        continue
      }
      lines[line] = -2
    }
  }

  return lines
}

function resolveCursorLine(text: string, lineStarts: readonly number[], offset: number) {
  if (!text.length) {
    return 0
  }

  const cursor = Math.max(0, Math.min(offset, text.length))
  const probe = cursor === text.length && cursor > 0 ? cursor - 1 : cursor
  return offsetToLineCol(probe, lineStarts).line
}

export function resolveSqlQueryAtOffset(
  snapshot: SqlAnalysisSnapshot,
  lineStarts: readonly number[],
  text: string,
  offset: number,
): SqlQueryResolution {
  const line = resolveCursorLine(text, lineStarts, offset)
  const startLine = snapshot.queryStartLineByLine[line] ?? -1
  if (startLine === -2) {
    return { kind: "ambiguous" }
  }
  if (startLine < 0) {
    return { kind: "none" }
  }

  const query = snapshot.queries.find(
    (item) => item.startLine === startLine && item.startLine <= line && line <= item.endLine,
  )
  if (!query) {
    return { kind: "none" }
  }

  return { kind: "query", query }
}

export function createSqlAnalysis(params: { theme: Accessor<SyntaxThemePalette>; logger: Logger }) {
  const highlighter = syntaxHighlighter({
    theme: params.theme,
    language: "sql",
    logger: params.logger,
  })
  const [snapshot, setSnapshot] = createSignal<SqlAnalysisSnapshot>({
    queries: [],
    queryStartLineByLine: [],
  })

  const refreshSnapshot = (statementCache: StatementCache | undefined, lineCount: number) => {
    const queries = statementCache?.statements.map((statement) => mapQuery(statement)) ?? []
    setSnapshot({
      queries,
      queryStartLineByLine: buildQueryStartLineByLine(queries, lineCount),
    })
  }

  const analysis: BufferAnalysis = {
    syntaxStyle: () => highlighter.highlightResult().syntaxStyle,
    createSession: (host) => {
      let statementId = 0
      let statementCache: StatementCache | undefined
      let previousStatements: StatementEntry[] = []
      let previousText = ""
      let appliedHighlightStyle = highlighter.highlightResult().syntaxStyle
      let materializedStatementHighlights = new Map<string, MaterializedHighlightEntry>()
      let statementHighlightGroupId = 1
      let highlightUpdateVersion = 0
      let isHighlightQueued = false
      let isHighlightRunning = false
      let highlightBackfillTimer: ReturnType<typeof setTimeout> | undefined
      let highlightBackfillCursor = 0
      let highlightedDocumentVersion = -1
      let lastEditAt = performance.now()
      let disposed = false

      const nextStatementId = () => {
        const id = `statement-${statementId}`
        statementId += 1
        return id
      }

      const nextStatementHighlightGroupId = () => {
        const id = statementHighlightGroupId
        statementHighlightGroupId += 1
        return id
      }

      const clearBackfillTimer = () => {
        if (highlightBackfillTimer === undefined) {
          return
        }

        clearTimeout(highlightBackfillTimer)
        highlightBackfillTimer = undefined
      }

      const clearRenderedHighlights = (requestRender: boolean) => {
        const ref = host.getRef()
        const highlights = materializedStatementHighlights
        materializedStatementHighlights = new Map()
        highlightedDocumentVersion = -1
        if (!ref || highlights.size === 0) {
          if (requestRender) {
            ref?.requestRender()
          }
          return
        }

        for (const entry of highlights.values()) {
          ref.editBuffer.removeHighlightsByRef(entry.highlightGroupId)
        }
        if (requestRender) {
          ref.requestRender()
        }
      }

      const invalidateRenderedHighlights = () => {
        if (materializedStatementHighlights.size === 0) {
          return
        }

        materializedStatementHighlights = new Map(
          [...materializedStatementHighlights].map(([id, entry]) => [
            id,
            { highlightGroupId: entry.highlightGroupId, version: -1 },
          ]),
        )
      }

      const buildWarmBatch = () => {
        const ref = host.getRef()
        if (!ref || !statementCache) {
          return undefined
        }

        const indices = collectVisibleStatementIndices(
          statementCache,
          ref.lineInfo,
          ref.scrollY,
          ref.height,
          host.getFocusedRow(),
          WARM_OVERSCAN_ROWS,
        )
        const dirtyIndices = indices.filter((index) => statementCache?.statements[index]?.dirty)
        if (dirtyIndices.length === 0) {
          return undefined
        }

        return buildStatementBatch(
          statementCache,
          host.getText(),
          dirtyIndices[0] ?? 0,
          dirtyIndices[dirtyIndices.length - 1] ?? 0,
        )
      }

      const findNextDirtyStatementIndex = (startIndex: number) => {
        if (!statementCache) {
          return undefined
        }

        for (let index = startIndex; index < statementCache.statements.length; index += 1) {
          if (statementCache.statements[index]?.dirty) {
            return index
          }
        }
        for (let index = 0; index < startIndex; index += 1) {
          if (statementCache.statements[index]?.dirty) {
            return index
          }
        }

        return undefined
      }

      const buildBackfillBatch = () => {
        if (!statementCache) {
          return undefined
        }

        const startIndex = findNextDirtyStatementIndex(highlightBackfillCursor)
        if (startIndex === undefined) {
          return undefined
        }

        const first = statementCache.statements[startIndex]
        if (!first) {
          return undefined
        }

        let endIndex = startIndex
        for (
          let count = 1;
          count < HIGHLIGHT_BACKFILL_BATCH_STATEMENTS && endIndex + 1 < statementCache.statements.length;
          count += 1
        ) {
          const next = statementCache.statements[endIndex + 1]
          if (!next) {
            break
          }
          if (next.end - first.start > HIGHLIGHT_BACKFILL_BATCH_CHARS) {
            break
          }
          endIndex += 1
        }

        return buildStatementBatch(statementCache, host.getText(), startIndex, endIndex)
      }

      const scheduleUpdate = () => {
        if (disposed || isHighlightQueued) {
          return
        }

        isHighlightQueued = true
        queueMicrotask(() => {
          isHighlightQueued = false
          runHighlightUpdate()
        })
      }

      const runHighlightBatch = async (batch: NonNullable<ReturnType<typeof buildStatementBatch>>) => {
        const updateVersion = highlightUpdateVersion
        if (!statementCache) {
          return
        }

        isHighlightRunning = true
        try {
          const spans = await highlighter.highlightText(batch.text)
          if (disposed || updateVersion !== highlightUpdateVersion || !statementCache) {
            return
          }

          applyStatementBatch(statementCache, batch, spans)
          previousStatements = statementCache.statements
          highlightBackfillCursor = Math.min(batch.endIndex + 1, Math.max(0, statementCache.statements.length - 1))
          host.requestSync()
        } catch (err) {
          if (!disposed && updateVersion === highlightUpdateVersion) {
            params.logger.error({ err }, "buffer: statement highlight failed")
          }
        } finally {
          isHighlightRunning = false
          scheduleUpdate()
        }
      }

      const runHighlightUpdate = () => {
        if (disposed || isHighlightRunning) {
          return
        }
        if (!statementCache || !hasDirtyStatements(statementCache)) {
          clearBackfillTimer()
          return
        }

        const warmBatch = buildWarmBatch()
        if (warmBatch) {
          void runHighlightBatch(warmBatch)
          return
        }

        const remainingQuietMs = lastEditAt + HIGHLIGHT_BACKFILL_QUIET_MS - performance.now()
        if (remainingQuietMs > 0) {
          if (highlightBackfillTimer === undefined) {
            highlightBackfillTimer = setTimeout(() => {
              highlightBackfillTimer = undefined
              scheduleUpdate()
            }, remainingQuietMs)
          }
          return
        }

        const backfillBatch = buildBackfillBatch()
        if (!backfillBatch) {
          clearBackfillTimer()
          return
        }

        void runHighlightBatch(backfillBatch)
      }

      const syncRenderedHighlights = () => {
        const ref = host.getRef()
        if (!ref || !statementCache) {
          clearRenderedHighlights(false)
          return
        }

        const style = highlighter.highlightResult().syntaxStyle
        if (appliedHighlightStyle !== style || statementCache.syntaxStyle !== style) {
          appliedHighlightStyle = style
          statementCache.syntaxStyle = style
          ref.syntaxStyle = style
        }

        const statements = collectVisibleStatements(
          statementCache,
          ref.lineInfo,
          ref.scrollY,
          ref.height,
          host.getFocusedRow(),
          VISIBLE_OVERSCAN_ROWS,
        )
        const visibleIds = new Set(statements.map((statement) => statement.id))
        const starts = host.getLineStarts()
        const value = host.getText()
        let changed = highlightedDocumentVersion !== host.getVersion()

        for (const [id, entry] of materializedStatementHighlights) {
          if (visibleIds.has(id)) {
            continue
          }

          ref.editBuffer.removeHighlightsByRef(entry.highlightGroupId)
          materializedStatementHighlights.delete(id)
          changed = true
        }

        for (const statement of statements) {
          const current = materializedStatementHighlights.get(statement.id)
          if (current?.version === statement.highlightVersion) {
            continue
          }

          const highlightGroupId = current?.highlightGroupId ?? nextStatementHighlightGroupId()
          if (current) {
            ref.editBuffer.removeHighlightsByRef(highlightGroupId)
          }

          for (const span of statement.spans) {
            addStatementHighlightSpanLines({
              ref,
              span,
              starts,
              text: value,
              tabWidth: host.tabWidth,
              highlightGroupId,
            })
          }

          materializedStatementHighlights.set(statement.id, {
            highlightGroupId,
            version: statement.highlightVersion,
          })
          changed = true
        }

        if (!changed) {
          return
        }

        highlightedDocumentVersion = host.getVersion()
        ref.requestRender()
      }

      return {
        rebuild: (text, lineStarts, version) => {
          statementCache = buildStatementCache(
            text,
            lineStarts,
            previousStatements,
            previousText,
            nextStatementId,
            highlighter.highlightResult().syntaxStyle,
            version,
          )
          previousStatements = statementCache.statements
          previousText = text
          refreshSnapshot(statementCache, lineStarts.length)
          scheduleUpdate()
        },
        reset: () => {
          highlightUpdateVersion += 1
          highlightBackfillCursor = 0
          lastEditAt = performance.now()
          clearBackfillTimer()
          clearRenderedHighlights(false)
          statementCache = undefined
          previousStatements = []
          previousText = ""
          appliedHighlightStyle = highlighter.highlightResult().syntaxStyle
          refreshSnapshot(undefined, host.getLineStarts().length)
        },
        invalidate: invalidateRenderedHighlights,
        sync: () => {
          syncRenderedHighlights()
          scheduleUpdate()
        },
        dispose: () => {
          disposed = true
          highlightUpdateVersion += 1
          clearBackfillTimer()
          clearRenderedHighlights(false)
        },
      }
    },
  }

  return {
    analysis,
    snapshot,
    dispose: () => {
      highlighter.dispose()
    },
  }
}
