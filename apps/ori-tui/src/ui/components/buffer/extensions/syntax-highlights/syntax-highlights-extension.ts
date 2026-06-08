import type { SyntaxStyle } from "@opentui/core"
import type { SyntaxHighlightSpan } from "@utils/syntax-highlighter"
import type { Accessor } from "solid-js"
import { createEffect } from "solid-js"
import type { Document } from "../../document"
import type { BufferExtension, BufferExtensionHost } from "../../extension"
import { viewportSnapshotRenderRange } from "../../viewport-snapshot"
import type { StatementSource } from "../statements"
import { createHighlightStore, type HighlightBatch } from "./highlight-store"
import { createRenderedHighlights } from "./rendered-highlights"

const VISIBLE_OVERSCAN_ROWS = 8
const WARM_OVERSCAN_ROWS = 24
const HIGHLIGHT_BACKFILL_QUIET_MS = 180
const HIGHLIGHT_BACKFILL_BATCH_STATEMENTS = 64
const HIGHLIGHT_BACKFILL_BATCH_CHARS = 24_000

export type SyntaxHighlightsOptions = {
  id: string
  statements: StatementSource
  syntaxStyle: Accessor<SyntaxStyle>
  highlightText: (text: string) => Promise<SyntaxHighlightSpan[]>
  onHighlightError?: (err: unknown, updateVersion: number) => void
}

function createSyntaxHighlightsRuntime(params: SyntaxHighlightsOptions & { host: BufferExtensionHost }) {
  const host = params.host
  const highlights = createRenderedHighlights()
  const store = createHighlightStore()
  let appliedHighlightStyle: SyntaxStyle | null = null
  let highlightUpdateVersion = 0
  let isHighlightQueued = false
  let isHighlightRunning = false
  let highlightBackfillTimer: ReturnType<typeof setTimeout> | undefined
  let highlightBackfillCursor = 0
  let lastEditAt = performance.now()
  let disposed = false

  const trackSyntaxStyleDependency = () => {
    params.syntaxStyle()
  }

  createEffect(() => {
    trackSyntaxStyleDependency()
    host.requestDecorationsRender()
  })

  const clearBackfillTimer = () => {
    if (highlightBackfillTimer === undefined) {
      return
    }

    clearTimeout(highlightBackfillTimer)
    highlightBackfillTimer = undefined
  }

  const readRenderContext = () => {
    const viewport = host.getViewport()
    const target = host.getRenderTarget()
    if (!viewport || !target) {
      return undefined
    }

    return {
      viewport,
      target,
    }
  }

  const buildWarmBatch = (preferFocusedStatement: boolean) => {
    const statements = params.statements.read()
    const snapshot = store.read()
    if (!statements || !snapshot) {
      return undefined
    }

    const viewport = host.getViewport()
    if (!viewport) {
      return undefined
    }
    const document = host.getDocument()
    const renderRange = viewportSnapshotRenderRange(viewport, WARM_OVERSCAN_ROWS)
    if (!renderRange) {
      return undefined
    }

    const indices = params.statements.collectVisibleIndices(viewport, WARM_OVERSCAN_ROWS)
    const dirtyIndices = indices.filter((index) => snapshot.entries[index]?.dirty)
    if (dirtyIndices.length === 0) {
      return undefined
    }

    const dirtyIndicesNeedingRender = dirtyIndices.filter((index) => {
      const statement = snapshot.entries[index]
      if (!statement) {
        return false
      }
      return statement.dirty || highlights.needsRenderRange(statement, renderRange)
    })
    if (dirtyIndicesNeedingRender.length === 0) {
      return undefined
    }

    if (
      preferFocusedStatement &&
      dirtyIndicesNeedingRender.length === 1 &&
      statements.lineToStatements[viewport.focusedLine]?.includes(dirtyIndicesNeedingRender[0] ?? -1)
    ) {
      const index = dirtyIndicesNeedingRender[0] ?? 0
      return store.buildBatch(document, index, index)
    }

    return store.buildBatch(
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
    const snapshot = store.read()
    if (!snapshot) {
      return undefined
    }

    for (let index = startIndex; index < snapshot.entries.length; index += 1) {
      if (snapshot.entries[index]?.dirty) {
        return index
      }
    }
    for (let index = 0; index < startIndex; index += 1) {
      if (snapshot.entries[index]?.dirty) {
        return index
      }
    }

    return undefined
  }

  const buildBackfillBatch = () => {
    const snapshot = store.read()
    if (!snapshot) {
      return undefined
    }

    const startIndex = findNextDirtyStatementIndex(highlightBackfillCursor)
    if (startIndex === undefined) {
      return undefined
    }

    const first = snapshot.entries[startIndex]
    if (!first) {
      return undefined
    }

    let endIndex = startIndex
    for (
      let count = 1;
      count < HIGHLIGHT_BACKFILL_BATCH_STATEMENTS && endIndex + 1 < snapshot.entries.length;
      count += 1
    ) {
      const next = snapshot.entries[endIndex + 1]
      if (!next) {
        break
      }
      if (next.end - first.start > HIGHLIGHT_BACKFILL_BATCH_CHARS) {
        break
      }
      endIndex += 1
    }

    return store.buildBatch(host.getDocument(), startIndex, endIndex)
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

  const runHighlightBatch = async (batch: HighlightBatch, options: { streamStatements: boolean }) => {
    const updateVersion = highlightUpdateVersion
    let lastCompletedIndex = batch.startIndex - 1
    let batchRenderedHighlights = false
    if (!store.read()) {
      return
    }

    isHighlightRunning = true
    try {
      const runStatement = async (index: number) => {
        const snapshot = store.read()
        const statement = snapshot?.entries[index]
        if (!snapshot || !statement) {
          return
        }

        const statementStart = statement.start - batch.startOffset
        const statementEnd = statement.end - batch.startOffset
        const statementText = batch.text.slice(statementStart, statementEnd)
        const statementSpans = await params.highlightText(statementText)
        const currentSnapshot = store.read()
        if (disposed || updateVersion !== highlightUpdateVersion || !currentSnapshot) {
          return
        }

        store.applyBatch(
          {
            startIndex: index,
            endIndex: index,
            startOffset: statement.start,
            text: statementText,
          },
          statementSpans,
        )
        lastCompletedIndex = Math.max(lastCompletedIndex, index)
        const nextStatement = currentSnapshot.entries[index]
        const context = readRenderContext()
        if (nextStatement && context) {
          const renderedImmediately = highlights.renderStatementIfNeeded({
            target: context.target,
            statement: nextStatement,
            viewport: context.viewport,
            renderRange: viewportSnapshotRenderRange(context.viewport, VISIBLE_OVERSCAN_ROWS),
          })
          if (renderedImmediately) {
            if (options.streamStatements) {
              context.target.requestRender()
            }
            batchRenderedHighlights = true
          }
        }

        if (options.streamStatements) {
          host.requestDecorationsRender()
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
      const snapshot = store.read()
      if (disposed || updateVersion !== highlightUpdateVersion || !snapshot) {
        return
      }

      if (!options.streamStatements && batchRenderedHighlights) {
        host.getRenderTarget()?.requestRender()
      }

      if (!options.streamStatements && lastCompletedIndex >= batch.startIndex) {
        highlightBackfillCursor = Math.min(lastCompletedIndex + 1, Math.max(0, snapshot.entries.length - 1))
      }
      if (!options.streamStatements && lastCompletedIndex >= batch.startIndex) {
        host.requestDecorationsRender()
      }
    } catch (err) {
      if (!disposed && updateVersion === highlightUpdateVersion) {
        params.onHighlightError?.(err, updateVersion)
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
    if (!store.hasDirty()) {
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

  const renderVisibleStatements = () => {
    const context = readRenderContext()
    const snapshot = store.read()
    if (!context || !snapshot) {
      highlights.clear(host.getRenderTarget(), false)
      return
    }

    let changed = false
    const style = params.syntaxStyle()
    if (appliedHighlightStyle !== style) {
      appliedHighlightStyle = style
      host.setSyntaxStyle(style)
      changed = true
    }

    const renderRange = viewportSnapshotRenderRange(context.viewport, VISIBLE_OVERSCAN_ROWS)
    changed =
      highlights.renderVisible({
        snapshot,
        target: context.target,
        viewport: context.viewport,
        overscan: VISIBLE_OVERSCAN_ROWS,
        renderRange,
      }) || changed

    if (!changed) {
      return
    }

    context.target.requestRender()
  }

  return {
    documentChanged: (document: Document, reason: "initial" | "edit" | "replace") => {
      if (reason === "replace") {
        highlightBackfillCursor = 0
        clearBackfillTimer()
        store.reset()
        highlights.clear(host.getRenderTarget(), false)
      }
      store.sync(params.statements.read(), document)
      highlightUpdateVersion += 1
      lastEditAt = performance.now()
      host.requestDecorationsRender()
      scheduleUpdate()
    },
    render: () => {
      renderVisibleStatements()
    },
    dispose: () => {
      disposed = true
      highlightUpdateVersion += 1
      clearBackfillTimer()
      highlights.clear(host.getRenderTarget(), false)
    },
  }
}

export function createSyntaxHighlightsExtension(options: SyntaxHighlightsOptions): BufferExtension {
  return {
    id: options.id,
    setup: (host) => {
      const runtime = createSyntaxHighlightsRuntime({ ...options, host })
      const unsubscribeDocument = host.onDocumentChange(({ document, reason }) => {
        runtime.documentChanged(document, reason)
      })
      const unsubscribeRender = host.onDecorationsRender(runtime.render)

      return () => {
        unsubscribeDocument()
        unsubscribeRender()
        runtime.dispose()
      }
    },
  }
}
