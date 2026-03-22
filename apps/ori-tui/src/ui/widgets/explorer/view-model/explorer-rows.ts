import { type Accessor, createComputed, createMemo, createSignal, untrack } from "solid-js"
import { fuzzyFilter } from "../../../../utils/fuzzy/fuzzy-search"
import type { ExplorerNode } from "../model/explorer-node"
import type { ExplorerGraph } from "./explorer-graph"
import type { UIMode } from "./explorer-types"

const SEARCH_RESULT_LIMIT = 100

export type ExplorerRowState = {
  id: string
  parentId?: string
  depth: number
  glyph: string
  label: string
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

export function createExplorerRows(options: CreateExplorerRowsOptions) {
  const [rows, setRows] = createSignal<ExplorerRowState[]>([])
  const [expandedNodes, setExpandedNodes] = createSignal<Record<string, true>>({})
  const [change, setChange] = createSignal<ExplorerRowsPatch | null>(null)
  const rootKey = createMemo(() => options.graph().rootIds.join("\0"))
  const rowObjects = new Map<string, ExplorerRow>()
  const indexById = createMemo(() => {
    const map = new Map<string, number>()
    const list = rows()
    for (let index = 0; index < list.length; index += 1) {
      const row = list[index]
      if (!row) continue
      map.set(row.id, index)
    }
    return map
  })
  let prevMode: UIMode | undefined
  let prevRootKey = ""

  createComputed(() => {
    const mode = options.mode()
    const filter = options.filter()
    const graph = options.graph()
    const roots = rootKey()

    if (mode === "search") {
      const next = buildSearchRows(graph, filter)
      setRows(next)
      setChange({ type: "reset", rows: next })
      prevMode = mode
      prevRootKey = roots
      return
    }

    if (prevMode !== "tree" || prevRootKey !== roots) {
      const next = buildTreeRows(graph, untrack(expandedNodes))
      setRows(next)
      setChange({ type: "reset", rows: next })
      prevMode = mode
      prevRootKey = roots
      return
    }

    syncTreeRows(graph)
    prevMode = mode
    prevRootKey = roots
  })

  const rowById = createMemo(() => {
    const map = new Map<string, ExplorerRowState>()
    for (const row of rows()) {
      map.set(row.id, row)
    }
    return map
  })

  const getRow = (id: string | null): ExplorerRow | null => {
    if (!id) return null
    const cached = rowObjects.get(id)
    if (cached) return cached
    const state = rowById().get(id)
    if (!state) return null
    const node = options.graph().nodesById[id]
    if (!node) return null
    const row: ExplorerRow = {
      get id() {
        return id
      },
      get depth() {
        return rowById().get(id)?.depth ?? 0
      },
      get hasChildren() {
        return rowById().get(id)?.hasChildren ?? false
      },
      get isExpanded() {
        return rowById().get(id)?.isExpanded ?? false
      },
      get node() {
        return options.graph().nodesById[id] ?? node
      },
      parent: () => {
        const parentId = rowById().get(id)?.parentId
        if (!parentId) return null
        return getRow(parentId)
      },
      children: () =>
        rows()
          .filter((child) => child.parentId === id)
          .map((child) => getRow(child.id))
          .filter((child): child is ExplorerRow => Boolean(child)),
      firstChild: () => {
        const visibleChildren = rows().filter((child) => child.parentId === id)
        for (const childRow of visibleChildren) {
          const child = getRow(childRow.id)
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

  const expandNode = (nodeId: string | null) => {
    if (!nodeId) return
    if (options.mode() !== "tree") return
    const current = rows()
    const match = findExplorerRow(current, nodeId)
    if (!match) return
    const currentRow = match.row
    if (!currentRow.hasChildren) return
    if (currentRow.isExpanded) return
    const nextExpanded: Record<string, true> = { ...expandedNodes(), [nodeId]: true }
    setExpandedNodes(nextExpanded)

    const nextRow = createRow(options.graph(), nodeId, currentRow.depth, currentRow.parentId, true)
    if (!nextRow) return
    const nextRows = current.slice()
    nextRows[match.index] = nextRow
    const patches: ExplorerRowsPatch[] = [{ type: "update", rows: [nextRow] }]
    const inserted = buildSubtreeRows(options.graph(), nextExpanded, nextRow.childIds, nodeId, currentRow.depth + 1)
    if (inserted.length > 0) {
      const insertAt = match.index + 1
      nextRows.splice(insertAt, 0, ...inserted)
      patches.push({ type: "insert", afterId: nodeId, rows: inserted })
    }
    setRows(nextRows)
    setChange(patches.length === 1 ? patches[0] : { type: "batch", patches })

    const node = options.graph().nodesById[nodeId]
    if (!node?.hasChildren) return
    const missingIds = node.childIds.filter((childId) => !options.graph().nodesById[childId])
    if (missingIds.length === 0) return
    void options.ensureNodes(missingIds)
  }

  const collapseNode = (nodeId: string | null) => {
    if (!nodeId) return
    if (options.mode() !== "tree") return
    const current = rows()
    const match = findExplorerRow(current, nodeId)
    if (!match) return
    if (!match.row.isExpanded) return
    const nextExpanded: Record<string, true> = { ...expandedNodes() }
    delete nextExpanded[nodeId]
    setExpandedNodes(nextExpanded)

    const range = getSubtreeRange(current, nodeId)
    const nextRow = createRow(options.graph(), nodeId, match.row.depth, match.row.parentId, false)
    if (!nextRow || !range) return
    const removedIds = current.slice(range.start, range.end).map((row) => row.id)
    const nextRows = current.slice()
    nextRows[match.index] = nextRow
    nextRows.splice(range.start, range.end - range.start)
    setRows(nextRows)
    if (removedIds.length === 0) {
      setChange({ type: "update", rows: [nextRow] })
      return
    }
    setChange({
      type: "batch",
      patches: [
        { type: "update", rows: [nextRow] },
        { type: "remove", rowIds: removedIds },
      ],
    })
  }

  const toggleNode = (nodeId: string | null) => {
    if (!nodeId) return
    if (isExpanded(nodeId)) {
      collapseNode(nodeId)
      return
    }
    expandNode(nodeId)
  }

  const isExpanded = (nodeId: string | null) => {
    if (!nodeId) return false
    return Boolean(expandedNodes()[nodeId])
  }

  return {
    rows,
    indexById,
    rowById,
    change,
    getRow,
    getState,
    isExpanded,
    expandNode,
    collapseNode,
    toggleNode,
  }

  function getState(id: string | null) {
    if (!id) return null
    return rowById().get(id) ?? null
  }

  function syncTreeRows(graph: ExplorerGraph) {
    const current = rows()
    const nextRows = current.slice()
    const updates: ExplorerRowState[] = []
    const expanded = untrack(expandedNodes)

    for (let index = 0; index < nextRows.length; index += 1) {
      const row = nextRows[index]
      if (!row) continue
      const nextRow = createRow(graph, row.id, row.depth, row.parentId, Boolean(expanded[row.id]))
      if (!nextRow) {
        const resetRows = buildTreeRows(graph, expanded)
        setRows(resetRows)
        setChange({ type: "reset", rows: resetRows })
        return
      }
      if (areRowsEqual(row, nextRow)) continue
      nextRows[index] = nextRow
      updates.push(nextRow)
    }

    const patches: ExplorerRowsPatch[] = []
    if (updates.length > 0) {
      patches.push({ type: "update", rows: updates })
    }

    for (let index = 0; index < nextRows.length; index += 1) {
      const row = nextRows[index]
      if (!row?.isExpanded) continue
      const visibleIds = getVisibleChildIds(nextRows, row.id)
      if (visibleIds.some((id) => !row.childIds.includes(id))) {
        const resetRows = buildTreeRows(graph, expanded)
        setRows(resetRows)
        setChange({ type: "reset", rows: resetRows })
        return
      }
      const missingIds = row.childIds.filter((id) => !visibleIds.includes(id))
      if (missingIds.length === 0) continue
      const afterId = visibleIds[visibleIds.length - 1] ?? row.id
      const inserted = buildSubtreeRows(graph, expanded, missingIds, row.id, row.depth + 1)
      if (inserted.length === 0) continue
      const insertAt = getInsertIndex(nextRows, afterId)
      nextRows.splice(insertAt, 0, ...inserted)
      patches.push({ type: "insert", afterId, rows: inserted })
      index += inserted.length
    }

    if (patches.length === 0) return
    setRows(nextRows)
    if (patches.length === 1) {
      setChange(patches[0])
      return
    }
    setChange({ type: "batch", patches })
  }
}

function buildSearchRows(graph: ExplorerGraph, filter: string) {
  const query = filter.trim()
  if (!query) return []
  const results = fuzzyFilter(query, graph.searchable, { keys: ["name"], limit: SEARCH_RESULT_LIMIT })
  const rows: ExplorerRowState[] = []
  for (const result of results) {
    const row = createRow(graph, result.id, 0)
    if (!row) continue
    rows.push({ ...row, glyph: "·", isExpanded: false, parentId: undefined })
  }
  return rows
}

function buildTreeRows(graph: ExplorerGraph, expandedNodes: Record<string, true>) {
  return buildSubtreeRows(graph, expandedNodes, graph.rootIds, undefined, 0)
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
  const childIds = node.childIds.filter((childId: string) => Boolean(graph.nodesById[childId]))
  const hasChildren = node.hasChildren
  return {
    id,
    parentId,
    depth,
    glyph: hasChildren ? (isExpanded ? "▽" : "▷") : "·",
    label: node.label,
    description: node.description,
    badges: node.badges,
    hasChildren,
    isExpanded,
    childIds,
  }
}

function areRowsEqual(left: ExplorerRowState, right: ExplorerRowState) {
  if (left === right) return true
  if (left.id !== right.id) return false
  if (left.parentId !== right.parentId) return false
  if (left.depth !== right.depth) return false
  if (left.glyph !== right.glyph) return false
  if (left.label !== right.label) return false
  if (left.description !== right.description) return false
  if (left.hasChildren !== right.hasChildren) return false
  if (left.isExpanded !== right.isExpanded) return false
  if (left.badges.length !== right.badges.length) return false
  if (left.childIds.length !== right.childIds.length) return false
  for (let index = 0; index < left.badges.length; index += 1) {
    if (left.badges[index] !== right.badges[index]) return false
  }
  for (let index = 0; index < left.childIds.length; index += 1) {
    if (left.childIds[index] !== right.childIds[index]) return false
  }
  return true
}

function getVisibleChildIds(rows: ExplorerRowState[], parentId: string) {
  const row = findExplorerRow(rows, parentId)
  if (!row) return []
  const ids: string[] = []
  for (let index = row.index + 1; index < rows.length; index += 1) {
    const child = rows[index]
    if (!child) continue
    if (child.depth <= row.row.depth) return ids
    if (child.depth !== row.row.depth + 1) continue
    if (child.parentId !== parentId) continue
    ids.push(child.id)
  }
  return ids
}

function getInsertIndex(rows: ExplorerRowState[], afterId: string | null) {
  if (!afterId) return 0
  const range = getRowRange(rows, afterId)
  if (!range) return rows.length
  return range.end
}

function getSubtreeRange(rows: ExplorerRowState[], nodeId: string) {
  const range = getRowRange(rows, nodeId)
  if (!range) return null
  return {
    start: range.start + 1,
    end: range.end,
  }
}

function getRowRange(rows: ExplorerRowState[], rowId: string) {
  const match = findExplorerRow(rows, rowId)
  if (!match) return null
  let end = match.index + 1
  for (; end < rows.length; end += 1) {
    const row = rows[end]
    if (!row) continue
    if (row.depth <= match.row.depth) break
  }
  return {
    start: match.index,
    end,
  }
}

export function isRowVisible(current: string | null, rowIndexMap: Map<string, number>) {
  if (!current) return false
  return rowIndexMap.has(current)
}

export function getFirstVisibleRowId(rows: ExplorerRowState[]) {
  return rows[0]?.id ?? null
}

export function moveVisibleRowId(
  current: string | null,
  delta: number,
  rows: ExplorerRowState[],
  rowIndexMap: Map<string, number>,
) {
  if (!rows.length) return null
  const index = current ? (rowIndexMap.get(current) ?? -1) : -1
  const base = index === -1 ? 0 : index
  const next = Math.max(0, Math.min(rows.length - 1, base + delta))
  return rows[next]?.id ?? null
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
