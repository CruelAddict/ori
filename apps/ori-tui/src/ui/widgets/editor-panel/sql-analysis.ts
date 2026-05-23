import type { TextareaRenderable } from "@opentui/core"
import type { BufferAnalysis, BufferTextChange } from "@ui/components/buffer/analysis"
import {
  addStatementHighlightRange,
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
import { collectSqlQueries } from "./sql-statement-detector"

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
  visibleStartOffset: number
  visibleEndOffset: number
}

type VisibleOffsetWindow = {
  start: number
  end: number
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

function getVisibleOffsetWindow(params: {
  info: TextareaRenderable["lineInfo"]
  scrollY: number
  height: number
  overscan: number
  starts: readonly number[]
  textLength: number
}): VisibleOffsetWindow | undefined {
  const visibleRowStart = Math.max(0, params.scrollY - params.overscan)
  const visibleRowEnd = Math.min(params.info.lineSources.length, params.scrollY + params.height + params.overscan)
  let visibleStartLine: number | undefined
  let visibleEndLine: number | undefined
  for (let row = visibleRowStart; row < visibleRowEnd; row += 1) {
    const line = params.info.lineSources[row]
    if (line === undefined) {
      continue
    }
    visibleStartLine = visibleStartLine === undefined ? line : Math.min(visibleStartLine, line)
    visibleEndLine = visibleEndLine === undefined ? line : Math.max(visibleEndLine, line)
  }
  if (visibleStartLine === undefined || visibleEndLine === undefined) {
    return undefined
  }

  return {
    start: params.starts[visibleStartLine] ?? 0,
    end: params.starts[visibleEndLine + 1] ?? params.textLength,
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
            {
              highlightGroupId: entry.highlightGroupId,
              version: -1,
              visibleStartOffset: entry.visibleStartOffset,
              visibleEndOffset: entry.visibleEndOffset,
            },
          ]),
        )
      }

      const syncStatementHighlights = (params: {
        ref: TextareaRenderable
        statement: StatementEntry
        starts: readonly number[]
        text: string
        visibleStartOffset?: number
        visibleEndOffset?: number
      }) => {
        const { ref, statement, starts, text, visibleStartOffset, visibleEndOffset } = params
        const statementVisibleStart =
          visibleStartOffset === undefined ? statement.start : Math.max(statement.start, visibleStartOffset)
        const statementVisibleEnd =
          visibleEndOffset === undefined ? statement.end : Math.min(statement.end, visibleEndOffset)
        if (statementVisibleEnd <= statementVisibleStart) {
          return false
        }

        const current = materializedStatementHighlights.get(statement.id)
        const coversVisibleRange =
          current !== undefined &&
          current.visibleStartOffset <= statementVisibleStart &&
          current.visibleEndOffset >= statementVisibleEnd
        if (current?.version === statement.highlightVersion && coversVisibleRange) {
          return false
        }
        if (statement.dirty && statement.spans.length === 0) {
          return false
        }

        if (current?.version === statement.highlightVersion) {
          if (statementVisibleStart < current.visibleStartOffset) {
            addStatementHighlightRange({
              ref,
              statement,
              starts,
              text,
              tabWidth: host.tabWidth,
              highlightGroupId: current.highlightGroupId,
              visibleStartOffset: statementVisibleStart,
              visibleEndOffset: current.visibleStartOffset,
            })
          }
          if (current.visibleEndOffset < statementVisibleEnd) {
            addStatementHighlightRange({
              ref,
              statement,
              starts,
              text,
              tabWidth: host.tabWidth,
              highlightGroupId: current.highlightGroupId,
              visibleStartOffset: current.visibleEndOffset,
              visibleEndOffset: statementVisibleEnd,
            })
          }

          materializedStatementHighlights.set(statement.id, {
            highlightGroupId: current.highlightGroupId,
            version: current.version,
            visibleStartOffset: Math.min(current.visibleStartOffset, statementVisibleStart),
            visibleEndOffset: Math.max(current.visibleEndOffset, statementVisibleEnd),
          })
          return true
        }

        const highlightGroupId = current?.highlightGroupId ?? nextStatementHighlightGroupId()
        if (current) {
          ref.editBuffer.removeHighlightsByRef(highlightGroupId)
        }

        addStatementHighlightRange({
          ref,
          statement,
          starts,
          text,
          tabWidth: host.tabWidth,
          highlightGroupId,
          visibleStartOffset: statementVisibleStart,
          visibleEndOffset: statementVisibleEnd,
        })

        materializedStatementHighlights.set(statement.id, {
          highlightGroupId,
          version: statement.highlightVersion,
          visibleStartOffset: statementVisibleStart,
          visibleEndOffset: statementVisibleEnd,
        })
        return true
      }

      const buildWarmBatch = (preferFocusedStatement: boolean) => {
        const ref = host.getRef()
        if (!ref || !statementCache) {
          return undefined
        }
        const starts = host.getLineStarts()
        const info = ref.lineInfo
        const visibleWindow = getVisibleOffsetWindow({
          info,
          scrollY: ref.scrollY,
          height: ref.height,
          overscan: WARM_OVERSCAN_ROWS,
          starts,
          textLength: host.getText().length,
        })
        if (!visibleWindow) {
          return undefined
        }

        const indices = collectVisibleStatementIndices(
          statementCache,
          info,
          ref.scrollY,
          ref.height,
          host.getFocusedRow(),
          WARM_OVERSCAN_ROWS,
        )
        const dirtyIndices = indices.filter((index) => statementCache?.statements[index]?.dirty)
        if (dirtyIndices.length === 0) {
          return undefined
        }

        const unmaterializedDirtyIndices = dirtyIndices.filter((index) => {
          const statement = statementCache?.statements[index]
          if (!statement) {
            return false
          }
          const current = materializedStatementHighlights.get(statement.id)
          if (!current) {
            return true
          }
          const statementVisibleStart = Math.max(statement.start, visibleWindow.start)
          const statementVisibleEnd = Math.min(statement.end, visibleWindow.end)
          return current.visibleStartOffset > statementVisibleStart || current.visibleEndOffset < statementVisibleEnd
        })
        if (unmaterializedDirtyIndices.length === 0) {
          return undefined
        }

        const focusedIndex = statementCache.lineToStatement[host.getFocusedRow()]
        if (
          preferFocusedStatement &&
          unmaterializedDirtyIndices.length === 1 &&
          focusedIndex !== undefined &&
          focusedIndex >= 0 &&
          unmaterializedDirtyIndices.includes(focusedIndex)
        ) {
          return buildStatementBatch(statementCache, host.getText(), focusedIndex, focusedIndex)
        }

        return buildStatementBatch(
          statementCache,
          host.getText(),
          unmaterializedDirtyIndices[0] ?? 0,
          unmaterializedDirtyIndices[unmaterializedDirtyIndices.length - 1] ?? 0,
        )
      }

      const scheduleQuietRetry = (remainingQuietMs: number) => {
        if (remainingQuietMs <= 0) {
          return false
        }
        if (highlightBackfillTimer !== undefined) {
          return true
        }

        highlightBackfillTimer = setTimeout(() => {
          highlightBackfillTimer = undefined
          scheduleUpdate()
        }, remainingQuietMs)
        return true
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

      const runHighlightBatch = async (
        batch: NonNullable<ReturnType<typeof buildStatementBatch>>,
        options: { streamStatements: boolean },
      ) => {
        const updateVersion = highlightUpdateVersion
        let lastCompletedIndex = batch.startIndex - 1
        let batchRenderedHighlights = false
        if (!statementCache) {
          return
        }

        isHighlightRunning = true
        try {
          const runStatement = async (index: number) => {
            const cache = statementCache
            const statement = cache?.statements[index]
            if (!cache || !statement) {
              return
            }

            const statementStart = statement.start - batch.startOffset
            const statementEnd = statement.end - batch.startOffset
            const statementText = batch.text.slice(statementStart, statementEnd)
            const statementSpans = await highlighter.highlightText(statementText)
            const currentCache = statementCache
            if (disposed || updateVersion !== highlightUpdateVersion || !currentCache) {
              return
            }

            applyStatementBatch(
              currentCache,
              {
                startIndex: index,
                endIndex: index,
                startOffset: statement.start,
                endOffset: statement.end,
                text: statementText,
              },
              statementSpans,
            )
            previousStatements = currentCache.statements
            lastCompletedIndex = Math.max(lastCompletedIndex, index)
            const nextStatement = currentCache.statements[index]
            const ref = host.getRef()
            if (nextStatement && ref) {
              const starts = host.getLineStarts()
              const text = host.getText()
              const info = ref.lineInfo
              const visibleWindow = getVisibleOffsetWindow({
                info,
                scrollY: ref.scrollY,
                height: ref.height,
                overscan: VISIBLE_OVERSCAN_ROWS,
                starts,
                textLength: text.length,
              })
              const immediateMaterialized = syncStatementHighlights({
                ref,
                statement: nextStatement,
                starts,
                text,
                visibleStartOffset: visibleWindow?.start,
                visibleEndOffset: visibleWindow?.end,
              })
              if (immediateMaterialized) {
                if (options.streamStatements) {
                  ref.requestRender()
                }
                batchRenderedHighlights = true
              }
            }

            if (options.streamStatements) {
              host.requestSync()
            }
          }

          if (options.streamStatements) {
            const tasks = [] as Promise<void>[]
            for (let index = batch.startIndex; index <= batch.endIndex; index += 1) {
              tasks.push(runStatement(index))
            }
            await Promise.all(tasks)
          }
          if (!options.streamStatements) {
            for (let index = batch.startIndex; index <= batch.endIndex; index += 1) {
              await runStatement(index)
            }
          }
          if (disposed || updateVersion !== highlightUpdateVersion || !statementCache) {
            return
          }

          if (!options.streamStatements && batchRenderedHighlights) {
            host.getRef()?.requestRender()
          }

          if (!options.streamStatements && lastCompletedIndex >= batch.startIndex) {
            highlightBackfillCursor = Math.min(
              lastCompletedIndex + 1,
              Math.max(0, statementCache.statements.length - 1),
            )
          }
          if (!options.streamStatements && lastCompletedIndex >= batch.startIndex) {
            host.requestSync()
          }
        } catch (err) {
          if (!disposed && updateVersion === highlightUpdateVersion) {
            params.logger.error({ err, updateVersion }, "sql-analysis: statement highlight failed")
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

        const now = performance.now()
        const remainingEditQuietMs = lastEditAt + HIGHLIGHT_BACKFILL_QUIET_MS - now
        const warmBatch = buildWarmBatch(remainingEditQuietMs > 0)
        if (warmBatch) {
          void runHighlightBatch(warmBatch, { streamStatements: true })
          return
        }

        if (scheduleQuietRetry(remainingEditQuietMs)) {
          return
        }

        const backfillBatch = buildBackfillBatch()
        if (!backfillBatch) {
          clearBackfillTimer()
          return
        }

        void runHighlightBatch(backfillBatch, { streamStatements: false })
      }

      const syncRenderedHighlights = () => {
        const ref = host.getRef()
        if (!ref || !statementCache) {
          clearRenderedHighlights(false)
          return
        }

        let changed = false
        const style = highlighter.highlightResult().syntaxStyle
        if (appliedHighlightStyle !== style || statementCache.syntaxStyle !== style) {
          appliedHighlightStyle = style
          statementCache.syntaxStyle = style
          ref.syntaxStyle = style
          changed = true
        }

        const info = ref.lineInfo
        const statements = collectVisibleStatements(
          statementCache,
          info,
          ref.scrollY,
          ref.height,
          host.getFocusedRow(),
          VISIBLE_OVERSCAN_ROWS,
        )
        const visibleIds = new Set(statements.map((statement) => statement.id))
        const starts = host.getLineStarts()
        const value = host.getText()
        const visibleWindow = getVisibleOffsetWindow({
          info,
          scrollY: ref.scrollY,
          height: ref.height,
          overscan: VISIBLE_OVERSCAN_ROWS,
          starts,
          textLength: value.length,
        })
        const visibleStartOffset = visibleWindow?.start
        const visibleEndOffset = visibleWindow?.end

        for (const [id, entry] of materializedStatementHighlights) {
          if (visibleIds.has(id)) {
            continue
          }

          ref.editBuffer.removeHighlightsByRef(entry.highlightGroupId)
          materializedStatementHighlights.delete(id)
          changed = true
        }

        for (const statement of statements) {
          if (syncStatementHighlights({ ref, statement, starts, text: value, visibleStartOffset, visibleEndOffset })) {
            changed = true
          }
        }

        if (!changed) {
          return
        }

        ref.requestRender()
      }

      return {
        rebuild: (text, lineStarts, version, change?: BufferTextChange) => {
          highlightUpdateVersion += 1
          lastEditAt = performance.now()
          clearRenderedHighlights(false)
          statementCache = buildStatementCache(
            text,
            lineStarts,
            previousStatements,
            previousText,
            nextStatementId,
            highlighter.highlightResult().syntaxStyle,
            version,
            change,
            collectSqlQueries,
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
        sync: (options = {}) => {
          syncRenderedHighlights()
          if (options.scheduleUpdate ?? true) {
            scheduleUpdate()
          }
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
