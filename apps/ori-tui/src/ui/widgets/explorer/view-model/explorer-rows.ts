import { type Accessor, createComputed, createMemo, createSignal, untrack } from "solid-js"
import { fuzzyFilter } from "../../../../utils/fuzzy/fuzzy-search"
import type { ExplorerGraph } from "./explorer-graph"
import type { UIMode } from "./explorer-types"

const SEARCH_RESULT_LIMIT = 100

export type RowSnapshot = {
  id: string
  parentId?: string
  depth: number
  name: string
  description?: string
  badges: string[]
  hasChildren: boolean
  isExpanded: boolean
  childIds: string[]
}

export type ExplorerRowsPatch =
  | { type: "insert"; afterId: string | null; rows: RowSnapshot[] }
  | { type: "remove"; rowIds: string[] }
  | { type: "update"; rows: RowSnapshot[] }
  | { type: "reset"; rows: RowSnapshot[] }
  | { type: "batch"; patches: ExplorerRowsPatch[] }

type CreateExplorerRowsOptions = {
  graph: Accessor<ExplorerGraph>
  mode: Accessor<UIMode>
  filter: Accessor<string>
  ensureNodes: (ids: string[]) => Promise<void>
}

type ExplorerRowLookup = {
  rowById: Map<string, RowSnapshot>
  indexById: Map<string, number>
  childIdsByParent: Map<string, string[]>
}

export function createExplorerRows(options: CreateExplorerRowsOptions) {
  const [rows, setRows] = createSignal<RowSnapshot[]>([])
  const [expandedNodes, setExpandedNodes] = createSignal<Record<string, true>>({})
  const [change, setChange] = createSignal<ExplorerRowsPatch | null>(null)
  const rowLookup = createMemo(() => buildRowLookup(rows()))
  let lastMode: UIMode | undefined

  createComputed(() => {
    const mode = options.mode()
    const graph = options.graph()

    if (mode === "search") {
      const nextRows = buildSearchRows(graph, options.filter())
      setRows(nextRows)
      setChange({ type: "reset", rows: nextRows })
      lastMode = mode
      return
    }

    const nextRows = buildSubtreeRows(graph, untrack(expandedNodes), graph.rootIds, undefined, 0)
    if (lastMode !== "tree") {
      setRows(nextRows)
      setChange({ type: "reset", rows: nextRows })
      lastMode = mode
      return
    }

    const patch = diffRows(untrack(rows), nextRows)
    lastMode = mode
    if (!patch) return
    setRows(nextRows)
    setChange(patch)
  })

  function expandNode(id: string) {
    if (options.mode() !== "tree") return

    const visibleRows = rows()
    const current = findExplorerRow(visibleRows, id)
    if (!current) return
    if (!current.row.hasChildren) return
    if (current.row.isExpanded) return

    const graph = options.graph()
    const nextExpanded: Record<string, true> = { ...expandedNodes() }
    nextExpanded[id] = true

    const expandedRow = createRow(graph, id, current.row.depth, current.row.parentId, true)
    if (!expandedRow) return

    const insertedRows = buildSubtreeRows(graph, nextExpanded, expandedRow.childIds, id, expandedRow.depth + 1)
    const nextRows = visibleRows.slice()
    nextRows[current.index] = expandedRow
    if (insertedRows.length > 0) {
      nextRows.splice(current.index + 1, 0, ...insertedRows)
    }

    setExpandedNodes(nextExpanded)
    setRows(nextRows)
    setChange(
      insertedRows.length === 0
        ? { type: "update", rows: [expandedRow] }
        : {
            type: "batch",
            patches: [
              { type: "update", rows: [expandedRow] },
              { type: "insert", afterId: id, rows: insertedRows },
            ],
          },
    )

    const node = graph.nodesById[id]
    if (!node?.hasChildren) return
    const missingIds = node.childIds.filter((childId) => !graph.nodesById[childId])
    if (missingIds.length === 0) return
    void options.ensureNodes(missingIds)
  }

  function collapseNode(id: string) {
    if (options.mode() !== "tree") return

    const visibleRows = rows()
    const current = findExplorerRow(visibleRows, id)
    if (!current) return
    if (!current.row.isExpanded) return

    const graph = options.graph()
    const collapsedRow = createRow(graph, id, current.row.depth, current.row.parentId, false)
    const subtree = getSubtreeRange(visibleRows, id)
    if (!collapsedRow || !subtree) return

    const removedIds = visibleRows.slice(subtree.start, subtree.end).map((row) => row.id)
    const nextExpanded: Record<string, true> = { ...expandedNodes() }
    delete nextExpanded[id]

    const nextRows = visibleRows.slice()
    nextRows[current.index] = collapsedRow
    nextRows.splice(subtree.start, subtree.end - subtree.start)

    setExpandedNodes(nextExpanded)
    setRows(nextRows)
    setChange(
      removedIds.length === 0
        ? { type: "update", rows: [collapsedRow] }
        : {
            type: "batch",
            patches: [
              { type: "update", rows: [collapsedRow] },
              { type: "remove", rowIds: removedIds },
            ],
          },
    )
  }

  function toggleNode(id: string) {
    if (isExpanded(id)) return collapseNode(id)
    expandNode(id)
  }

  function isExpanded(id: string) {
    return Boolean(expandedNodes()[id])
  }

  function getState(id: string) {
    return rowLookup().rowById.get(id) ?? null
  }

  function getParentId(id: string) {
    return rowLookup().rowById.get(id)?.parentId ?? null
  }

  function getChildIds(id: string) {
    return rowLookup().childIdsByParent.get(id) ?? []
  }

  function getFirstChildId(id: string) {
    return getChildIds(id)[0] ?? null
  }

  return {
    rows,
    rowById: () => rowLookup().rowById,
    indexById: () => rowLookup().indexById,
    change,
    getState,
    getParentId,
    getChildIds,
    getFirstChildId,
    isExpanded,
    expandNode,
    collapseNode,
    toggleNode,
  }
}

function buildSearchRows(graph: ExplorerGraph, filter: string) {
  const query = filter.trim()
  if (!query) return []

  const rows: RowSnapshot[] = []
  const matches = fuzzyFilter(query, graph.searchable, { keys: ["name"], limit: SEARCH_RESULT_LIMIT })
  for (const match of matches) {
    const row = createRow(graph, match.id, 0)
    if (!row) continue
    rows.push({ ...row, isExpanded: false, parentId: undefined })
  }
  return rows
}

function buildSubtreeRows(
  graph: ExplorerGraph,
  expandedNodes: Record<string, true>,
  ids: string[],
  parentId: string | undefined,
  depth: number,
) {
  const rows: RowSnapshot[] = []
  for (const id of ids) {
    const row = createRow(graph, id, depth, parentId, Boolean(expandedNodes[id]))
    if (!row) continue
    rows.push(row)
    if (!row.isExpanded) continue
    rows.push(...buildSubtreeRows(graph, expandedNodes, row.childIds, id, depth + 1))
  }
  return rows
}

function createRow(graph: ExplorerGraph, id: string, depth: number, parentId?: string, isExpanded = false) {
  const node = graph.nodesById[id]
  if (!node) return undefined

  const childIds = node.childIds.filter((childId) => Boolean(graph.nodesById[childId]))
  return {
    id,
    parentId,
    depth,
    name: node.name,
    description: node.description,
    badges: node.badges,
    hasChildren: node.hasChildren,
    isExpanded,
    childIds,
  }
}

function buildRowLookup(rows: RowSnapshot[]): ExplorerRowLookup {
  const rowById = new Map<string, RowSnapshot>()
  const indexById = new Map<string, number>()
  const childIdsByParent = new Map<string, string[]>()

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    if (!row) continue
    rowById.set(row.id, row)
    indexById.set(row.id, index)
    if (!row.parentId) continue

    const ids = childIdsByParent.get(row.parentId)
    if (ids) {
      ids.push(row.id)
      continue
    }
    childIdsByParent.set(row.parentId, [row.id])
  }

  return { rowById, indexById, childIdsByParent }
}

function diffRows(currentRows: RowSnapshot[], nextRows: RowSnapshot[]): ExplorerRowsPatch | null {
  if (
    haveSameIds(
      currentRows.map((row) => row.id),
      nextRows.map((row) => row.id),
    )
  ) {
    const updatedRows: RowSnapshot[] = []
    for (let index = 0; index < nextRows.length; index += 1) {
      const nextRow = nextRows[index]
      const currentRow = currentRows[index]
      if (!nextRow || !currentRow) continue
      if (areRowsEqual(currentRow, nextRow)) continue
      updatedRows.push(nextRow)
    }
    if (updatedRows.length === 0) return null
    return { type: "update", rows: updatedRows }
  }

  const currentIds = new Set(currentRows.map((row) => row.id))
  const nextIds = new Set(nextRows.map((row) => row.id))
  const currentSharedIds = currentRows.filter((row) => nextIds.has(row.id)).map((row) => row.id)
  const nextSharedIds = nextRows.filter((row) => currentIds.has(row.id)).map((row) => row.id)
  if (!haveSameIds(currentSharedIds, nextSharedIds)) {
    return { type: "reset", rows: nextRows }
  }

  const currentRowsById = new Map(currentRows.map((row) => [row.id, row]))
  const updatedRows: RowSnapshot[] = []
  for (const nextRow of nextRows) {
    const currentRow = currentRowsById.get(nextRow.id)
    if (!currentRow) continue
    if (areRowsEqual(currentRow, nextRow)) continue
    updatedRows.push(nextRow)
  }

  const removedRowIds = currentRows.filter((row) => !nextIds.has(row.id)).map((row) => row.id)
  const insertedPatches = collectInsertPatches(nextRows, currentIds)
  const patches: ExplorerRowsPatch[] = []
  if (updatedRows.length > 0) {
    patches.push({ type: "update", rows: updatedRows })
  }
  if (removedRowIds.length > 0) {
    patches.push({ type: "remove", rowIds: removedRowIds })
  }
  patches.push(...insertedPatches)
  if (patches.length === 0) return null
  if (patches.length === 1) return patches[0]
  return { type: "batch", patches }
}

function collectInsertPatches(nextRows: RowSnapshot[], currentIds: Set<string>) {
  const patches: Array<Extract<ExplorerRowsPatch, { type: "insert" }>> = []
  let afterId: string | null = null
  let insertedRows: RowSnapshot[] = []

  for (const row of nextRows) {
    if (!currentIds.has(row.id)) {
      insertedRows.push(row)
      continue
    }
    if (insertedRows.length > 0) {
      patches.push({ type: "insert", afterId, rows: insertedRows })
      insertedRows = []
    }
    afterId = row.id
  }

  if (insertedRows.length > 0) {
    patches.push({ type: "insert", afterId, rows: insertedRows })
  }
  return patches
}

function haveSameIds(currentIds: string[], nextIds: string[]) {
  if (currentIds.length !== nextIds.length) return false
  for (let index = 0; index < currentIds.length; index += 1) {
    if (currentIds[index] !== nextIds[index]) return false
  }
  return true
}

function areRowsEqual(currentRow: RowSnapshot, nextRow: RowSnapshot) {
  if (currentRow === nextRow) return true
  if (currentRow.id !== nextRow.id) return false
  if (currentRow.parentId !== nextRow.parentId) return false
  if (currentRow.depth !== nextRow.depth) return false
  if (currentRow.name !== nextRow.name) return false
  if (currentRow.description !== nextRow.description) return false
  if (currentRow.hasChildren !== nextRow.hasChildren) return false
  if (currentRow.isExpanded !== nextRow.isExpanded) return false
  if (currentRow.badges.length !== nextRow.badges.length) return false
  if (currentRow.childIds.length !== nextRow.childIds.length) return false

  for (let index = 0; index < currentRow.badges.length; index += 1) {
    if (currentRow.badges[index] !== nextRow.badges[index]) return false
  }
  for (let index = 0; index < currentRow.childIds.length; index += 1) {
    if (currentRow.childIds[index] !== nextRow.childIds[index]) return false
  }
  return true
}

function getSubtreeRange(rows: RowSnapshot[], rowId: string) {
  const range = getRowRange(rows, rowId)
  if (!range) return null
  return { start: range.start + 1, end: range.end }
}

function getRowRange(rows: RowSnapshot[], rowId: string) {
  const current = findExplorerRow(rows, rowId)
  if (!current) return null

  let end = current.index + 1
  for (; end < rows.length; end += 1) {
    const row = rows[end]
    if (!row) continue
    if (row.depth <= current.row.depth) break
  }
  return { start: current.index, end }
}

export const getFirstVisibleRowId = (rows: Array<{ id: string }>) => rows[0]?.id ?? null

export function moveVisibleRowId(
  current: string,
  delta: number,
  rows: Array<{ id: string }>,
  rowIndexMap: Map<string, number>,
) {
  if (!rows.length) return null
  const currentIndex = rowIndexMap.get(current) ?? -1
  const baseIndex = currentIndex === -1 ? 0 : currentIndex
  const nextIndex = Math.max(0, Math.min(rows.length - 1, baseIndex + delta))
  return rows[nextIndex]?.id ?? null
}

export function findExplorerRow<Row extends { id: string }>(rows: Row[], rowId: string) {
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    if (!row) continue
    if (row.id !== rowId) continue
    return { index, row }
  }
  return null
}
