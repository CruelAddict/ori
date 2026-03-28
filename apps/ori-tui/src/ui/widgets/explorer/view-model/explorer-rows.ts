import { type Accessor, createComputed, createMemo, createSignal, untrack } from "solid-js"
import { fuzzyFilter } from "../../../../utils/fuzzy/fuzzy-search"
import type { ExplorerGraph } from "./explorer-graph"
import type { ExplorerNode } from "./explorer-node"
import type { UIMode } from "./explorer-types"

const SEARCH_RESULT_LIMIT = 100

export type ExplorerRowState = {
  id: string
  parentId?: string
  depth: number
  glyph: string
  name: string
  description?: string
  badges: string[]
  hasChildren: boolean
  isExpanded: boolean
  childIds: string[]
}

export type ExplorerRow = {
  readonly id: string
  readonly depth: number
  readonly hasChildren: boolean
  readonly isExpanded: boolean
  readonly node: ExplorerNode
  parent: () => ExplorerRow | null
  children: () => ExplorerRow[]
  firstChild: () => ExplorerRow | null
  expand: () => void
  collapse: () => void
  toggle: () => void
}

export type ExplorerRowsPatch =
  | { type: "insert"; afterId: string | null; rows: ExplorerRowState[] }
  | { type: "remove"; rowIds: string[] }
  | { type: "update"; rows: ExplorerRowState[] }
  | { type: "reset"; rows: ExplorerRowState[] }
  | { type: "batch"; patches: ExplorerRowsPatch[] }

type CreateExplorerRowsOptions = {
  graph: Accessor<ExplorerGraph>
  mode: Accessor<UIMode>
  filter: Accessor<string>
  ensureNodes: (ids: string[]) => Promise<void>
}

type CreateExplorerRowsResult = {
  rows: Accessor<ExplorerRowState[]>
  rowById: () => Map<string, ExplorerRowState>
  indexById: () => Map<string, number>
  change: Accessor<ExplorerRowsPatch | null>
  getRow: (id: string) => ExplorerRow | null
  getState: (id: string) => ExplorerRowState | null
  isExpanded: (id: string) => boolean
  expandNode: (id: string) => void
  collapseNode: (id: string) => void
  toggleNode: (id: string) => void
}

type ExplorerRowLookup = {
  rowById: Map<string, ExplorerRowState>
  indexById: Map<string, number>
  childIdsByParent: Map<string, string[]>
}

export function createExplorerRows(options: CreateExplorerRowsOptions): CreateExplorerRowsResult {
  const [rows, setRows] = createSignal<ExplorerRowState[]>([])
  const [expandedNodes, setExpandedNodes] = createSignal<Record<string, true>>({})
  const [change, setChange] = createSignal<ExplorerRowsPatch | null>(null)
  const rowObjects = new Map<string, ExplorerRow>()
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

    const nextRows = buildTreeRows(graph, untrack(expandedNodes))
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

  const getRow = (id: string): ExplorerRow | null => {
    const cached = rowObjects.get(id)
    if (cached) return cached
    if (!rowLookup().rowById.has(id)) return null
    const node = options.graph().nodesById[id]
    if (!node) return null

    const row: ExplorerRow = {
      get id() {
        return id
      },
      get depth() {
        return rowLookup().rowById.get(id)?.depth ?? 0
      },
      get hasChildren() {
        return rowLookup().rowById.get(id)?.hasChildren ?? false
      },
      get isExpanded() {
        return rowLookup().rowById.get(id)?.isExpanded ?? false
      },
      get node() {
        return options.graph().nodesById[id] ?? node
      },
      parent: () => {
        const parentId = rowLookup().rowById.get(id)?.parentId
        if (!parentId) return null
        return getRow(parentId)
      },
      children: () => {
        const ids = rowLookup().childIdsByParent.get(id) ?? []
        return ids.map((childId) => getRow(childId)).filter((child): child is ExplorerRow => Boolean(child))
      },
      firstChild: () => {
        for (const childId of rowLookup().childIdsByParent.get(id) ?? []) {
          const child = getRow(childId)
          if (child) return child
        }
        return null
      },
      expand: () => expandNode(id),
      collapse: () => collapseNode(id),
      toggle: () => toggleNode(id),
    }

    rowObjects.set(id, row)
    return row
  }

  const expandNode = (nodeId: string) => {
    if (options.mode() !== "tree") return

    const visibleRows = rows()
    const current = findExplorerRow(visibleRows, nodeId)
    if (!current) return
    if (!current.row.hasChildren) return
    if (current.row.isExpanded) return

    const graph = options.graph()
    const nextExpanded = { ...expandedNodes() }
    nextExpanded[nodeId] = true

    const expandedRow = createRow(graph, nodeId, current.row.depth, current.row.parentId, true)
    if (!expandedRow) return

    const insertedRows = buildSubtreeRows(graph, nextExpanded, expandedRow.childIds, nodeId, expandedRow.depth + 1)
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
              { type: "insert", afterId: nodeId, rows: insertedRows },
            ],
          },
    )

    const node = graph.nodesById[nodeId]
    if (!node?.hasChildren) return
    const missingIds = node.childIds.filter((childId) => !graph.nodesById[childId])
    if (missingIds.length === 0) return
    void options.ensureNodes(missingIds)
  }

  const collapseNode = (nodeId: string) => {
    if (options.mode() !== "tree") return

    const visibleRows = rows()
    const current = findExplorerRow(visibleRows, nodeId)
    if (!current) return
    if (!current.row.isExpanded) return

    const graph = options.graph()
    const collapsedRow = createRow(graph, nodeId, current.row.depth, current.row.parentId, false)
    const subtree = getSubtreeRange(visibleRows, nodeId)
    if (!collapsedRow || !subtree) return

    const removedIds = visibleRows.slice(subtree.start, subtree.end).map((row) => row.id)
    const nextExpanded = { ...expandedNodes() }
    delete nextExpanded[nodeId]

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

  const toggleNode = (nodeId: string) => {
    if (isExpanded(nodeId)) return collapseNode(nodeId)
    expandNode(nodeId)
  }

  const isExpanded = (nodeId: string) => Boolean(expandedNodes()[nodeId])

  return {
    rows,
    rowById: () => rowLookup().rowById,
    indexById: () => rowLookup().indexById,
    change,
    getRow,
    getState: (id: string) => rowLookup().rowById.get(id) ?? null,
    isExpanded,
    expandNode,
    collapseNode,
    toggleNode,
  }
}

function buildTreeRows(graph: ExplorerGraph, expandedNodes: Record<string, true>) {
  return buildSubtreeRows(graph, expandedNodes, graph.rootIds, undefined, 0)
}

function buildSearchRows(graph: ExplorerGraph, filter: string) {
  const query = filter.trim()
  if (!query) return []

  const rows: ExplorerRowState[] = []
  const matches = fuzzyFilter(query, graph.searchable, { keys: ["name"], limit: SEARCH_RESULT_LIMIT })
  for (const match of matches) {
    const row = createRow(graph, match.id, 0)
    if (!row) continue
    rows.push({ ...row, glyph: "·", isExpanded: false, parentId: undefined })
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
  const rows: ExplorerRowState[] = []
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
    glyph: node.hasChildren ? (isExpanded ? "▽" : "▷") : "·",
    name: node.name,
    description: node.description,
    badges: node.badges,
    hasChildren: node.hasChildren,
    isExpanded,
    childIds,
  }
}

function buildRowLookup(rows: ExplorerRowState[]): ExplorerRowLookup {
  const rowById = new Map<string, ExplorerRowState>()
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

function diffRows(currentRows: ExplorerRowState[], nextRows: ExplorerRowState[]): ExplorerRowsPatch | null {
  if (haveSameRowIds(currentRows, nextRows)) {
    const updatedRows: ExplorerRowState[] = []
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
  const updatedRows: ExplorerRowState[] = []
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

function collectInsertPatches(nextRows: ExplorerRowState[], currentIds: Set<string>) {
  const patches: Array<Extract<ExplorerRowsPatch, { type: "insert" }>> = []
  let afterId: string | null = null
  let insertedRows: ExplorerRowState[] = []

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

function haveSameRowIds(currentRows: ExplorerRowState[], nextRows: ExplorerRowState[]) {
  if (currentRows.length !== nextRows.length) return false
  for (let index = 0; index < currentRows.length; index += 1) {
    if (currentRows[index]?.id !== nextRows[index]?.id) return false
  }
  return true
}

function haveSameIds(currentIds: string[], nextIds: string[]) {
  if (currentIds.length !== nextIds.length) return false
  for (let index = 0; index < currentIds.length; index += 1) {
    if (currentIds[index] !== nextIds[index]) return false
  }
  return true
}

function areRowsEqual(currentRow: ExplorerRowState, nextRow: ExplorerRowState) {
  if (currentRow === nextRow) return true
  if (currentRow.id !== nextRow.id) return false
  if (currentRow.parentId !== nextRow.parentId) return false
  if (currentRow.depth !== nextRow.depth) return false
  if (currentRow.glyph !== nextRow.glyph) return false
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

function getSubtreeRange(rows: ExplorerRowState[], rowId: string) {
  const range = getRowRange(rows, rowId)
  if (!range) return null
  return { start: range.start + 1, end: range.end }
}

function getRowRange(rows: ExplorerRowState[], rowId: string) {
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

export const getFirstVisibleRowId = (rows: ExplorerRowState[]) => rows[0]?.id ?? null

export function moveVisibleRowId(
  current: string,
  delta: number,
  rows: ExplorerRowState[],
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
