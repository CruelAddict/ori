import type { SyntaxStyle, TextareaRenderable } from "@opentui/core"
import type { SyntaxHighlightSpan } from "@utils/syntax-highlighter"
import type { Accessor } from "solid-js"
import { renderStatementHighlightRange } from "./buffer-highlight-renderer"
import {
  applyStatementBatch,
  buildStatementBatch,
  buildStatementCache,
  collectVisibleStatementIndices,
  collectVisibleStatements,
  hasDirtyStatements,
  type StatementCache,
  type StatementEntry,
} from "./buffer-statement-cache"
import { type DocCharOffset, type DocCharRange, type DocumentVersion, docCharOffset, type LineIndex } from "./coords"
import type { BufferTextChange, Document } from "./document"
import type { RenderTarget } from "./render-target"
import { type Viewport, viewportRenderRange } from "./viewport"

export type BufferAnalysisRange = {
  start: DocCharOffset
  end: DocCharOffset
  startLine: LineIndex
  endLine: LineIndex
}

export type BufferAnalysisEntry = BufferAnalysisRange & {
  id: string
  spans: SyntaxHighlightSpan[]
  dirty: boolean
  highlightVersion: number
}

export type BufferAnalysisSnapshot = {
  version: DocumentVersion | string
  entries: readonly BufferAnalysisEntry[]
  lineToEntry: readonly number[]
}

export type BufferAnalysis = {
  languageId?: string
  syntaxStyle: Accessor<SyntaxStyle>
  collectRanges?: (text: string, lineStarts: readonly DocCharOffset[]) => BufferAnalysisRange[]
  highlightText?: (text: string) => Promise<SyntaxHighlightSpan[]>
  onSnapshotChange?: (snapshot: BufferAnalysisSnapshot | undefined, lineCount: number) => void
  onHighlightError?: (err: unknown, updateVersion: number) => void
}

type AnalysisHost = {
  getRef: () => TextareaRenderable | undefined
  getViewport: () => Viewport | undefined
  getRenderTarget: (ref: TextareaRenderable) => RenderTarget
  getDocument: () => Document
  requestSync: () => void
}

type AnalysisHighlightLayer = {
  rebuild: (document: Document, change?: BufferTextChange) => void
  reset: () => void
  invalidate: () => void
  sync: (options?: { scheduleUpdate?: boolean }) => void
  dispose: () => void
}

const VISIBLE_OVERSCAN_ROWS = 8
const WARM_OVERSCAN_ROWS = 24
const HIGHLIGHT_BACKFILL_QUIET_MS = 180
const HIGHLIGHT_BACKFILL_BATCH_STATEMENTS = 64
const HIGHLIGHT_BACKFILL_BATCH_CHARS = 24_000

type RenderedHighlightEntry = {
  highlightGroupId: number
  version: number
  renderRange: DocCharRange
}

function createNoopAnalysisHighlightLayer(): AnalysisHighlightLayer {
  return {
    rebuild: () => {},
    reset: () => {},
    invalidate: () => {},
    sync: () => {},
    dispose: () => {},
  }
}

export function createAnalysisHighlightLayer(params: {
  analysis: BufferAnalysis
  host: AnalysisHost
}): AnalysisHighlightLayer {
  const collectRanges = params.analysis.collectRanges
  const highlightText = params.analysis.highlightText
  if (!collectRanges || !highlightText) {
    return createNoopAnalysisHighlightLayer()
  }

  const host = params.host
  let statementId = 0
  let statementCache: StatementCache | undefined
  let previousStatements: StatementEntry[] = []
  let previousText = ""
  let appliedHighlightStyle = params.analysis.syntaxStyle()
  let renderedStatementHighlights = new Map<string, RenderedHighlightEntry>()
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

  const refreshSnapshot = (cache: StatementCache | undefined, lineCount: number) => {
    params.analysis.onSnapshotChange?.(
      cache
        ? {
            version: cache.version,
            entries: cache.statements,
            lineToEntry: cache.lineToStatement,
          }
        : undefined,
      lineCount,
    )
  }

  const clearBackfillTimer = () => {
    if (highlightBackfillTimer === undefined) {
      return
    }

    clearTimeout(highlightBackfillTimer)
    highlightBackfillTimer = undefined
  }

  const getStatementRenderRange = (statement: StatementEntry, renderRange: DocCharRange | undefined) => {
    return {
      start: docCharOffset(renderRange === undefined ? statement.start : Math.max(statement.start, renderRange.start)),
      end: docCharOffset(renderRange === undefined ? statement.end : Math.min(statement.end, renderRange.end)),
    } satisfies DocCharRange
  }

  const readRenderContext = () => {
    const ref = host.getRef()
    const viewport = host.getViewport()
    if (!ref || !viewport) {
      return undefined
    }

    return {
      ref,
      viewport,
      target: host.getRenderTarget(ref),
    }
  }

  const clearRenderedHighlights = (requestRender: boolean) => {
    const ref = host.getRef()
    const highlights = renderedStatementHighlights
    renderedStatementHighlights = new Map()
    if (!ref || highlights.size === 0) {
      if (requestRender) {
        ref?.requestRender()
      }
      return
    }

    const target = host.getRenderTarget(ref)
    for (const entry of highlights.values()) {
      target.removeHighlightsByRef(entry.highlightGroupId)
    }
    if (requestRender) {
      target.requestRender()
    }
  }

  const invalidateRenderedHighlights = () => {
    if (renderedStatementHighlights.size === 0) {
      return
    }

    renderedStatementHighlights = new Map(
      [...renderedStatementHighlights].map(([id, entry]) => [
        id,
        {
          highlightGroupId: entry.highlightGroupId,
          version: -1,
          renderRange: entry.renderRange,
        },
      ]),
    )
  }

  const syncStatementHighlights = (options: {
    target: RenderTarget
    statement: StatementEntry
    viewport: Viewport
    renderRange?: DocCharRange
  }) => {
    const { target, statement, viewport, renderRange } = options
    const statementRenderRange = getStatementRenderRange(statement, renderRange)
    if (statementRenderRange.end <= statementRenderRange.start) {
      return false
    }

    const current = renderedStatementHighlights.get(statement.id)
    const coversRenderRange =
      current !== undefined &&
      current.renderRange.start <= statementRenderRange.start &&
      current.renderRange.end >= statementRenderRange.end
    if (current?.version === statement.highlightVersion && coversRenderRange) {
      return false
    }
    if (statement.dirty && statement.spans.length === 0) {
      return false
    }

    if (current?.version === statement.highlightVersion) {
      if (statementRenderRange.start < current.renderRange.start) {
        renderStatementHighlightRange({
          target,
          statement,
          geometry: viewport.geometry,
          highlightGroupId: current.highlightGroupId,
          renderRange: {
            start: statementRenderRange.start,
            end: current.renderRange.start,
          },
        })
      }
      if (current.renderRange.end < statementRenderRange.end) {
        renderStatementHighlightRange({
          target,
          statement,
          geometry: viewport.geometry,
          highlightGroupId: current.highlightGroupId,
          renderRange: {
            start: current.renderRange.end,
            end: statementRenderRange.end,
          },
        })
      }

      renderedStatementHighlights.set(statement.id, {
        highlightGroupId: current.highlightGroupId,
        version: current.version,
        renderRange: {
          start: docCharOffset(Math.min(current.renderRange.start, statementRenderRange.start)),
          end: docCharOffset(Math.max(current.renderRange.end, statementRenderRange.end)),
        },
      })
      return true
    }

    const highlightGroupId = current?.highlightGroupId ?? nextStatementHighlightGroupId()
    if (current) {
      target.removeHighlightsByRef(highlightGroupId)
    }

    renderStatementHighlightRange({
      target,
      statement,
      geometry: viewport.geometry,
      highlightGroupId,
      renderRange: statementRenderRange,
    })

    renderedStatementHighlights.set(statement.id, {
      highlightGroupId,
      version: statement.highlightVersion,
      renderRange: statementRenderRange,
    })
    return true
  }

  const buildWarmBatch = (preferFocusedStatement: boolean) => {
    if (!statementCache) {
      return undefined
    }

    const viewport = host.getViewport()
    if (!viewport) {
      return undefined
    }
    const document = host.getDocument()
    const renderRange = viewportRenderRange(viewport, WARM_OVERSCAN_ROWS)
    if (!renderRange) {
      return undefined
    }

    const indices = collectVisibleStatementIndices(
      statementCache,
      viewport.lineInfo,
      viewport.scrollY,
      viewport.height,
      viewport.focusedLine,
      WARM_OVERSCAN_ROWS,
    )
    const dirtyIndices = indices.filter((index) => statementCache?.statements[index]?.dirty)
    if (dirtyIndices.length === 0) {
      return undefined
    }

    const dirtyIndicesNeedingRender = dirtyIndices.filter((index) => {
      const statement = statementCache?.statements[index]
      if (!statement) {
        return false
      }
      const current = renderedStatementHighlights.get(statement.id)
      if (!current) {
        return true
      }
      const statementRenderRange = getStatementRenderRange(statement, renderRange)
      return (
        current.renderRange.start > statementRenderRange.start || current.renderRange.end < statementRenderRange.end
      )
    })
    if (dirtyIndicesNeedingRender.length === 0) {
      return undefined
    }

    const focusedIndex = statementCache.lineToStatement[viewport.focusedLine]
    if (
      preferFocusedStatement &&
      dirtyIndicesNeedingRender.length === 1 &&
      focusedIndex !== undefined &&
      focusedIndex >= 0 &&
      dirtyIndicesNeedingRender.includes(focusedIndex)
    ) {
      return buildStatementBatch(statementCache, document, focusedIndex, focusedIndex)
    }

    return buildStatementBatch(
      statementCache,
      document,
      dirtyIndicesNeedingRender[0] ?? 0,
      dirtyIndicesNeedingRender[dirtyIndicesNeedingRender.length - 1] ?? 0,
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

    return buildStatementBatch(statementCache, host.getDocument(), startIndex, endIndex)
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
        const statementSpans = await highlightText(statementText)
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
        const context = readRenderContext()
        if (nextStatement && context) {
          const renderedImmediately = syncStatementHighlights({
            target: context.target,
            statement: nextStatement,
            viewport: context.viewport,
            renderRange: viewportRenderRange(context.viewport, VISIBLE_OVERSCAN_ROWS),
          })
          if (renderedImmediately) {
            if (options.streamStatements) {
              context.target.requestRender()
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
        const ref = host.getRef()
        if (ref) {
          host.getRenderTarget(ref).requestRender()
        }
      }

      if (!options.streamStatements && lastCompletedIndex >= batch.startIndex) {
        highlightBackfillCursor = Math.min(lastCompletedIndex + 1, Math.max(0, statementCache.statements.length - 1))
      }
      if (!options.streamStatements && lastCompletedIndex >= batch.startIndex) {
        host.requestSync()
      }
    } catch (err) {
      if (!disposed && updateVersion === highlightUpdateVersion) {
        params.analysis.onHighlightError?.(err, updateVersion)
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
    const context = readRenderContext()
    if (!context || !statementCache) {
      clearRenderedHighlights(false)
      return
    }

    let changed = false
    const style = params.analysis.syntaxStyle()
    if (appliedHighlightStyle !== style || statementCache.syntaxStyle !== style) {
      appliedHighlightStyle = style
      statementCache.syntaxStyle = style
      context.ref.syntaxStyle = style
      changed = true
    }

    const statements = collectVisibleStatements(
      statementCache,
      context.viewport.lineInfo,
      context.viewport.scrollY,
      context.viewport.height,
      context.viewport.focusedLine,
      VISIBLE_OVERSCAN_ROWS,
    )
    const visibleIds = new Set(statements.map((statement) => statement.id))
    const renderRange = viewportRenderRange(context.viewport, VISIBLE_OVERSCAN_ROWS)

    for (const [id, entry] of renderedStatementHighlights) {
      if (visibleIds.has(id)) {
        continue
      }

      context.target.removeHighlightsByRef(entry.highlightGroupId)
      renderedStatementHighlights.delete(id)
      changed = true
    }

    for (const statement of statements) {
      if (syncStatementHighlights({ target: context.target, statement, viewport: context.viewport, renderRange })) {
        changed = true
      }
    }

    if (!changed) {
      return
    }

    context.target.requestRender()
  }

  return {
    rebuild: (document, change?: BufferTextChange) => {
      highlightUpdateVersion += 1
      lastEditAt = performance.now()
      clearRenderedHighlights(false)
      statementCache = buildStatementCache(
        document,
        previousStatements,
        previousText,
        nextStatementId,
        params.analysis.syntaxStyle(),
        document.version,
        change,
        collectRanges,
      )
      previousStatements = statementCache.statements
      previousText = document.text
      refreshSnapshot(statementCache, document.lineStarts.length)
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
      appliedHighlightStyle = params.analysis.syntaxStyle()
      refreshSnapshot(undefined, host.getDocument().lineStarts.length)
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
}
