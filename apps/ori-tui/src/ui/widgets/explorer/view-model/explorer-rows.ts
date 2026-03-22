import { type Accessor, createComputed, createMemo, createSignal, untrack } from "solid-js"
import { fuzzyFilter } from "../../../../utils/fuzzy/fuzzy-search"
import type { UIMode } from "./create-vm"
import type { ExplorerGraph } from "./explorer-graph"

const SEARCH_RESULT_LIMIT = 100

export type ExplorerRow = {
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

export type ExplorerRowsPatch =
  | { type: "insert"; afterId: string | null; rows: ExplorerRow[] }
  | { type: "remove"; rowIds: string[] }
  | { type: "update"; rows: ExplorerRow[] }
  | { type: "reset"; rows: ExplorerRow[] }
  | { type: "batch"; patches: ExplorerRowsPatch[] }

type CreateExplorerRowsOptions = {
  graph: Accessor<ExplorerGraph>
  mode: Accessor<UIMode>
  filter: Accessor<string>
}

export function createExplorerRows(options: CreateExplorerRowsOptions) {
  const [rows, setRows] = createSignal<ExplorerRow[]>([])
  const [expandedNodes, setExpandedNodes] = createSignal<Record<string, true>>({})
  const [change, setChange] = createSignal<ExplorerRowsPatch | null>(null)
  const rootKey = createMemo(() => options.graph().rootIds.join("\0"))
  let prevMode: UIMode | undefined
  let _prevFilter = ""
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
      _prevFilter = filter
      prevRootKey = roots
      return
    }

    if (prevMode !== "default" || prevRootKey !== roots) {
      const next = buildDefaultRows(graph, untrack(expandedNodes))
      setRows(next)
      setChange({ type: "reset", rows: next })
      prevMode = mode
      _prevFilter = filter
      prevRootKey = roots
      return
    }

    syncDefaultRows(graph)
    prevMode = mode
    _prevFilter = filter
    prevRootKey = roots
  })

  const expandNode = (nodeId: string | null) => {
    if (!nodeId) return
    if (options.mode() !== "default") return
    const current = rows()
    const match = findExplorerRow(current, nodeId)
    if (!match) return
    const row = match.row
    if (!row.hasChildren) return
    if (row.isExpanded) return
    const nextExpanded: Record<string, true> = { ...expandedNodes(), [nodeId]: true }
    setExpandedNodes(nextExpanded)

    const nextRow = createRow(options.graph(), nodeId, row.depth, row.parentId, true)
    if (!nextRow) return
    const nextRows = current.slice()
    nextRows[match.index] = nextRow
    const patches: ExplorerRowsPatch[] = [{ type: "update", rows: [nextRow] }]
    const inserted = buildSubtreeRows(options.graph(), nextExpanded, nextRow.childIds, nodeId, row.depth + 1)
    if (inserted.length > 0) {
      const insertAt = match.index + 1
      nextRows.splice(insertAt, 0, ...inserted)
      patches.push({ type: "insert", afterId: nodeId, rows: inserted })
    }
    setRows(nextRows)
    setChange(patches.length === 1 ? patches[0] : { type: "batch", patches })
  }

  const collapseNode = (nodeId: string | null) => {
    if (!nodeId) return
    if (options.mode() !== "default") return
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

  const isExpanded = (nodeId: string | null) => {
    if (!nodeId) return false
    return Boolean(expandedNodes()[nodeId])
  }

  return {
    rows,
    change,
    isExpanded,
    expandNode,
    collapseNode,
  }

  function syncDefaultRows(graph: ExplorerGraph) {
    const current = rows()
    const nextRows = current.slice()
    const updates: ExplorerRow[] = []
    const expanded = untrack(expandedNodes)

    for (let index = 0; index < nextRows.length; index += 1) {
      const row = nextRows[index]
      if (!row) continue
      const nextRow = createRow(graph, row.id, row.depth, row.parentId, Boolean(expanded[row.id]))
      if (!nextRow) {
        const resetRows = buildDefaultRows(graph, expanded)
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
        const resetRows = buildDefaultRows(graph, expanded)
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
  const rows: ExplorerRow[] = []
  for (const result of results) {
    const row = createRow(graph, result.id, 0)
    if (!row) continue
    rows.push({ ...row, glyph: "·", isExpanded: false, parentId: undefined })
  }
  return rows
}

function buildDefaultRows(graph: ExplorerGraph, expandedNodes: Record<string, true>) {
  return buildSubtreeRows(graph, expandedNodes, graph.rootIds, undefined, 0)
}

function buildSubtreeRows(
  graph: ExplorerGraph,
  expandedNodes: Record<string, true>,
  ids: string[],
  parentId: string | undefined,
  depth: number,
) {
  const rows: ExplorerRow[] = []
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

function areRowsEqual(left: ExplorerRow, right: ExplorerRow) {
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

function getVisibleChildIds(rows: ExplorerRow[], parentId: string) {
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

function getInsertIndex(rows: ExplorerRow[], afterId: string | null) {
  if (!afterId) return 0
  const range = getRowRange(rows, afterId)
  if (!range) return rows.length
  return range.end
}

function getSubtreeRange(rows: ExplorerRow[], nodeId: string) {
  const range = getRowRange(rows, nodeId)
  if (!range) return null
  return {
    start: range.start + 1,
    end: range.end,
  }
}

function getRowRange(rows: ExplorerRow[], rowId: string) {
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

type NormalizeSelectedIdOptions = {
  preserveHidden?: boolean
}

export function normalizeSelectedId(
  current: string | null,
  rows: ExplorerRow[],
  rowIndexMap: Map<string, number>,
  options?: NormalizeSelectedIdOptions,
) {
  const preserveHidden = options?.preserveHidden ?? true
  if (!rows.length) return current
  if (!current) return rows[0]?.id ?? null
  if (rowIndexMap.has(current)) return current
  if (!preserveHidden) return rows[0]?.id ?? null
  return current
}

export function moveSelectedId(
  current: string | null,
  delta: number,
  rows: ExplorerRow[],
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
