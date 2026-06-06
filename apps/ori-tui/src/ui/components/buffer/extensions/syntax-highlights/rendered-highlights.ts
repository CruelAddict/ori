import { type DocCharRange, docCharOffset } from "../../coords"
import { renderHighlights } from "../../highlights"
import type { RenderTarget } from "../../render-target"
import type { ViewportSnapshot } from "../../viewport-snapshot"
import type { HighlightEntry, HighlightSnapshot } from "./highlight-store"

type RenderedHighlightEntry = {
  highlightGroupId: number
  version: number
  renderRange: DocCharRange
}

function getStatementRenderRange(statement: HighlightEntry, renderRange: DocCharRange | undefined) {
  return {
    start: docCharOffset(renderRange === undefined ? statement.start : Math.max(statement.start, renderRange.start)),
    end: docCharOffset(renderRange === undefined ? statement.end : Math.min(statement.end, renderRange.end)),
  } satisfies DocCharRange
}

export function createRenderedHighlights() {
  let rendered = new Map<string, RenderedHighlightEntry>()
  let highlightGroupId = 1

  const nextHighlightGroupId = () => {
    const id = highlightGroupId
    highlightGroupId += 1
    return id
  }

  const clear = (target: RenderTarget | undefined, requestRender: boolean) => {
    const highlights = rendered
    rendered = new Map()
    if (!target || highlights.size === 0) {
      if (requestRender) {
        target?.requestRender()
      }
      return
    }

    for (const entry of highlights.values()) {
      target.removeHighlightsByRef(entry.highlightGroupId)
    }
    if (requestRender) {
      target.requestRender()
    }
  }

  const needsRenderRange = (statement: HighlightEntry, renderRange: DocCharRange | undefined) => {
    const current = rendered.get(statement.id)
    if (!current) {
      return true
    }

    const statementRenderRange = getStatementRenderRange(statement, renderRange)
    return current.renderRange.start > statementRenderRange.start || current.renderRange.end < statementRenderRange.end
  }

  const renderStatementIfNeeded = (options: {
    target: RenderTarget
    statement: HighlightEntry
    viewport: ViewportSnapshot
    renderRange?: DocCharRange
  }) => {
    const { target, statement, viewport, renderRange } = options
    const statementRenderRange = getStatementRenderRange(statement, renderRange)
    if (statementRenderRange.end <= statementRenderRange.start) {
      return false
    }

    const current = rendered.get(statement.id)
    const coversRenderRange =
      current !== undefined &&
      current.renderRange.start <= statementRenderRange.start &&
      current.renderRange.end >= statementRenderRange.end
    if (current?.version === statement.highlightVersion && coversRenderRange) {
      return false
    }
    if (statement.dirty && statement.spans.length === 0) {
      if (current) {
        target.removeHighlightsByRef(current.highlightGroupId)
        rendered.delete(statement.id)
        return true
      }

      return false
    }

    if (current?.version === statement.highlightVersion) {
      if (statementRenderRange.start < current.renderRange.start) {
        renderHighlights({
          target,
          source: statement,
          geometry: viewport.geometry,
          groupId: current.highlightGroupId,
          renderRange: {
            start: statementRenderRange.start,
            end: current.renderRange.start,
          },
        })
      }
      if (current.renderRange.end < statementRenderRange.end) {
        renderHighlights({
          target,
          source: statement,
          geometry: viewport.geometry,
          groupId: current.highlightGroupId,
          renderRange: {
            start: current.renderRange.end,
            end: statementRenderRange.end,
          },
        })
      }

      rendered.set(statement.id, {
        highlightGroupId: current.highlightGroupId,
        version: current.version,
        renderRange: {
          start: docCharOffset(Math.min(current.renderRange.start, statementRenderRange.start)),
          end: docCharOffset(Math.max(current.renderRange.end, statementRenderRange.end)),
        },
      })
      return true
    }

    const highlightGroupId = current?.highlightGroupId ?? nextHighlightGroupId()
    if (current) {
      target.removeHighlightsByRef(highlightGroupId)
    }

    renderHighlights({
      target,
      source: statement,
      geometry: viewport.geometry,
      groupId: highlightGroupId,
      renderRange: statementRenderRange,
    })

    rendered.set(statement.id, {
      highlightGroupId,
      version: statement.highlightVersion,
      renderRange: statementRenderRange,
    })
    return true
  }

  const renderVisible = (options: {
    snapshot: HighlightSnapshot
    target: RenderTarget
    viewport: ViewportSnapshot
    overscan: number
    renderRange?: DocCharRange
  }) => {
    const { snapshot, target, viewport, overscan, renderRange } = options
    let changed = false
    const statements: HighlightEntry[] = []
    const seen = new Set<number>()
    const pushIndex = (index: number | undefined) => {
      if (index === undefined || index < 0 || seen.has(index)) {
        return
      }

      const statement = snapshot.entries[index]
      if (!statement) {
        return
      }

      seen.add(index)
      statements.push(statement)
    }

    const startRow = Math.max(0, viewport.scrollY - overscan)
    const endRow = Math.min(viewport.layout.sourceLines.length, viewport.scrollY + viewport.height + overscan)
    for (let row = startRow; row < endRow; row += 1) {
      const line = viewport.layout.sourceLines[row]
      if (line === undefined) {
        continue
      }
      pushIndex(snapshot.lineToStatement[line])
    }

    pushIndex(snapshot.lineToStatement[viewport.focusedLine])
    const visibleIds = new Set(statements.map((statement) => statement.id))

    for (const [id, entry] of rendered) {
      if (visibleIds.has(id)) {
        continue
      }

      target.removeHighlightsByRef(entry.highlightGroupId)
      rendered.delete(id)
      changed = true
    }

    for (const statement of statements) {
      if (renderStatementIfNeeded({ target, statement, viewport, renderRange })) {
        changed = true
      }
    }

    return changed
  }

  return {
    clear,
    needsRenderRange,
    renderStatementIfNeeded,
    renderVisible,
  }
}
