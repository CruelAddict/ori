import { type Accessor, createComputed, createSignal, onCleanup, untrack } from "solid-js"
import type { ExplorerRowsPatch, RowSnapshot } from "./explorer-rows"

const CHILD_BATCH_SIZE = 10

type ActiveRenderPatch = {
  afterId: string | null
  rows: RowSnapshot[]
  nextIndex: number
}

type NonBatchExplorerRowsPatch = Exclude<ExplorerRowsPatch, { type: "batch" }>

type CreateBufferedRowsOptions = {
  change: Accessor<ExplorerRowsPatch | null>
}

export function createBufferedRows(options: CreateBufferedRowsOptions) {
  const [rows, setRows] = createSignal<RowSnapshot[]>([])
  const stack: ActiveRenderPatch[] = []
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null

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

  return rows

  function applyChange(change: NonBatchExplorerRowsPatch) {
    if (change.type === "reset") {
      clearSchedule()
      stack.length = 0
      setRows(change.rows)
      return
    }

    if (change.type === "update") {
      const updates = new Map(change.rows.map((row) => [row.id, row]))
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

    const insertedRows = change.rows
    if (insertedRows.length === 0) return
    stack.unshift({ afterId: change.afterId, rows: insertedRows, nextIndex: 0 })
    process()
  }

  function process() {
    timeoutHandle = null
    const next = applyBufferPatchStep(untrack(rows), stack)
    stack.splice(0, stack.length, ...next.stack)
    setRows(next.rows)
    if (stack.length === 0) return
    schedule()
  }

  function schedule() {
    if (timeoutHandle !== null) return
    timeoutHandle = setTimeout(process, 10)
  }

  function clearSchedule() {
    if (timeoutHandle === null) return
    clearTimeout(timeoutHandle)
    timeoutHandle = null
  }
}

export function applyBufferPatchStep(
  currentRows: RowSnapshot[],
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

function getInsertIndex(rows: RowSnapshot[], afterId: string | null) {
  if (!afterId) return 0
  const match = rows.findIndex((row) => row.id === afterId)
  if (match === -1) return rows.length
  return match + 1
}
