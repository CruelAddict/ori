import { TextAttributes } from "@opentui/core"
import { type Accessor, createComputed, createMemo, createSignal, onCleanup, untrack } from "solid-js"
import type { ExplorerRow, ExplorerRowState, ExplorerRowsPatch } from "./explorer-rows"

const CHILD_BATCH_SIZE = 10

export type ExplorerRenderedRowElement = {
  text: string
  role: "glyph" | "main" | "description" | "badge"
  attributes?: number
}

export type ExplorerRenderedRowState = {
  id: string
  parentId?: string
  width: number
  elements: ExplorerRenderedRowElement[]
}

export type ExplorerRenderedRow = {
  readonly id: string
  readonly width: number
  readonly elements: readonly ExplorerRenderedRowElement[]
  readonly row: ExplorerRow
  parent: () => ExplorerRenderedRow | null
  children: () => ExplorerRenderedRow[]
  firstChild: () => ExplorerRenderedRow | null
}

type ActiveRenderPatch = {
  afterId: string | null
  rows: ExplorerRenderedRowState[]
  nextIndex: number
}

type NonBatchExplorerRowsPatch = Exclude<ExplorerRowsPatch, { type: "batch" }>

type CreateExplorerRenderedRowsOptions = {
  change: Accessor<ExplorerRowsPatch | null>
  getRow: (id: string) => ExplorerRow | null
}

export function createExplorerRenderedRows(options: CreateExplorerRenderedRowsOptions) {
  const [rows, setRows] = createSignal<ExplorerRenderedRowState[]>([])
  const renderedRows = new Map<string, ExplorerRenderedRow>()
  const stack: ActiveRenderPatch[] = []
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null

  const rowById = createMemo(() => {
    const map = new Map<string, ExplorerRenderedRowState>()
    for (const row of rows()) {
      map.set(row.id, row)
    }
    return map
  })

  const getRenderedRow = (id: string): ExplorerRenderedRow | null => {
    const cached = renderedRows.get(id)
    if (cached) return cached
    const state = rowById().get(id)
    if (!state) return null
    const row = options.getRow(id)
    if (!row) return null
    const renderedRow: ExplorerRenderedRow = {
      get id() {
        return id
      },
      get width() {
        return rowById().get(id)?.width ?? 0
      },
      get elements() {
        return rowById().get(id)?.elements ?? []
      },
      get row() {
        return options.getRow(id) ?? row
      },
      parent: () => {
        const parentId = rowById().get(id)?.parentId
        if (!parentId) return null
        return getRenderedRow(parentId)
      },
      children: () => {
        const visibleChildren = renderedRow.row.children()
        return visibleChildren
          .map((child) => getRenderedRow(child.id))
          .filter((child): child is ExplorerRenderedRow => Boolean(child))
      },
      firstChild: () => {
        const child = renderedRow.row.firstChild()
        if (!child) return null
        return getRenderedRow(child.id)
      },
    }
    renderedRows.set(id, renderedRow)
    return renderedRow
  }

  const visibleRows = createMemo(() =>
    rows()
      .map((row) => getRenderedRow(row.id))
      .filter((row): row is ExplorerRenderedRow => Boolean(row)),
  )

  const clearSchedule = () => {
    if (timeoutHandle === null) return
    clearTimeout(timeoutHandle)
    timeoutHandle = null
  }

  const schedule = () => {
    if (timeoutHandle !== null) return
    timeoutHandle = setTimeout(process, 10)
  }

  const enqueueInsert = (afterId: string | null, insertedRows: ExplorerRenderedRowState[]) => {
    if (insertedRows.length === 0) return
    stack.unshift({ afterId, rows: insertedRows, nextIndex: 0 })
    process()
  }

  const process = () => {
    timeoutHandle = null
    const next = applyRenderPatchStep(untrack(rows), stack)
    stack.splice(0, stack.length, ...next.stack)
    setRows(next.rows)
    if (stack.length === 0) return
    schedule()
  }

  createComputed(() => {
    const patch = options.change()
    if (!patch) return
    if (patch.type === "batch") {
      for (const item of patch.patches) {
        applyChange(item as NonBatchExplorerRowsPatch)
      }
      return
    }
    applyChange(patch)
  })

  onCleanup(() => {
    clearSchedule()
    stack.length = 0
  })

  return visibleRows

  function applyChange(change: NonBatchExplorerRowsPatch) {
    if (change.type === "reset") {
      clearSchedule()
      stack.length = 0
      setRows(change.rows.map(renderRow))
      return
    }

    if (change.type === "update") {
      const updates = new Map(change.rows.map((row) => [row.id, renderRow(row)]))
      setRows((current) => current.map((row) => updates.get(row.id) ?? row))
      return
    }

    if (change.type === "remove") {
      clearSchedule()
      const removedIds = new Set(change.rowIds)
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        const active = stack[index]
        if (!active) continue
        active.rows = active.rows.filter((row) => !removedIds.has(row.id))
        if (active.rows.length > 0) continue
        stack.splice(index, 1)
      }
      setRows((current) => current.filter((row) => !removedIds.has(row.id)))
      if (stack.length > 0) schedule()
      return
    }

    enqueueInsert(change.afterId, change.rows.map(renderRow))
  }
}

export function applyRenderPatchStep(
  currentRows: ExplorerRenderedRowState[],
  currentStack: ActiveRenderPatch[],
  batchSize = CHILD_BATCH_SIZE,
) {
  const stack = currentStack.slice()
  const active = stack[0]
  if (!active) {
    return { rows: currentRows, stack }
  }

  const rows = currentRows.slice()
  const limit = Math.min(active.rows.length, active.nextIndex + batchSize)
  let afterId = active.afterId

  for (let index = active.nextIndex; index < limit; index += 1) {
    const row = active.rows[index]
    if (!row) continue
    const insertAt = getInsertIndex(rows, afterId)
    rows.splice(insertAt, 0, row)
    afterId = row.id
  }

  if (limit >= active.rows.length) {
    stack.shift()
    return { rows, stack }
  }

  stack[0] = {
    afterId,
    rows: active.rows,
    nextIndex: limit,
  }
  return { rows, stack }
}

function renderRow(row: ExplorerRowState): ExplorerRenderedRowState {
  const elements: ExplorerRenderedRowElement[] = [
    { text: `${row.glyph} `, role: "glyph", attributes: TextAttributes.DIM },
    { text: row.name, role: "main" },
  ]

  if (row.description) {
    elements.push({ text: ` ${row.description}`, role: "description", attributes: TextAttributes.DIM })
  }

  if (row.badges.length > 0) {
    elements.push({ text: ` ${row.badges.join(" • ")}`, role: "badge" })
  }

  return {
    id: row.id,
    parentId: row.parentId,
    width: elements.reduce((sum, element) => sum + element.text.length, 0),
    elements,
  }
}

function getInsertIndex(rows: ExplorerRenderedRowState[], afterId: string | null) {
  if (!afterId) return 0
  const match = rows.findIndex((row) => row.id === afterId)
  if (match === -1) return rows.length
  return match + 1
}
