import { type Node, NodeType } from "@adapters/ori/client"
import type { ResourceIntrospectionUsecase } from "@usecase/introspection/usecase"
import type { Accessor } from "solid-js"
import { batch, createComputed, createMemo, createSignal, on, onCleanup } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { fuzzyFilter } from "../../../../utils/fuzzy/fuzzy-search"
import type { ExplorerNode } from "../model/explorer-node"
import { createExplorerNodesById } from "./explorer-graph"

const CHILD_BATCH_SIZE = 10
const SEARCH_RESULT_LIMIT = 100

type CreateVMOptions = {
  introspection: Introspection
  isFocused: Accessor<boolean>
  focusSelf: () => void
}

export type UIMode = "default" | "search"

export type VisibleRow = {
  id: string
  parentId?: string
  depth: number
}

type RevealBatch = {
  parentId: string | null
  afterId: string | null
  rows: VisibleRow[]
  childBatches: Record<string, RevealBatch>
  onFinish?: () => void
}

type Introspection = Pick<ResourceIntrospectionUsecase, "subscribe" | "getState" | "load" | "refresh" | "ensureNodes">

export function createVM(options: CreateVMOptions) {
  const [nodesByIdState, setNodesByIdState] = createSignal(options.introspection.getState().nodesById)
  const [rootIdsState, setRootIdsState] = createSignal(options.introspection.getState().rootIds)
  const [loadingState, setLoadingState] = createSignal(options.introspection.getState().loading)
  const [errorState, setErrorState] = createSignal(options.introspection.getState().error)
  const [mode, setMode] = createSignal("default" as UIMode)
  const [filter, setFilter] = createSignal("")
  const [selectedId, setSelectedId] = createSignal<string | null>(null)
  const [expandedNodes, setExpandedNodes] = createStore<Record<string, true>>({})

  const setUIMode = (mode: UIMode) => setMode(mode)

  const unsubscribe = options.introspection.subscribe(() => {
    const state = options.introspection.getState()
    setNodesByIdState(state.nodesById)
    setRootIdsState(state.rootIds)
    setLoadingState(state.loading)
    setErrorState(state.error)
  })

  onCleanup(() => {
    unsubscribe()
  })

  void options.introspection.load()

  const snapshotNodesById = createMemo(() => nodesByIdState())
  const rootIds = createMemo(() => rootIdsState())
  const loading = createMemo(() => loadingState())
  const error = createMemo(() => errorState())
  const nodesById = createMemo(() => createExplorerNodesById(snapshotNodesById()))
  const getNode = (nodeId: string | null) => (nodeId ? nodesById()[nodeId] : undefined)
  const isExpanded = (nodeId: string | null) => (nodeId ? Boolean(expandedNodes[nodeId]) : false)
  const getLoadedChildIds = (nodeId: string | null) => {
    const node = getNode(nodeId)
    if (!node) return []
    return node.childIds.filter((childId) => Boolean(getNode(childId)))
  }

  const flatSearchableNodes = createMemo(() =>
    Object.values(nodesById()).map((node) => ({
      id: node.id,
      name: node.label,
    })),
  )

  const filteredNodeIds = createMemo(() => {
    if (mode() !== "search") return []
    const query = filter()
    if (!query.trim()) return []
    const items = flatSearchableNodes()
    const results = fuzzyFilter(query, items, { keys: ["name"], limit: SEARCH_RESULT_LIMIT })
    return results.map((result) => result.id)
  })

  createComputed(() => {
    const nodes = nodesById()
    setExpandedNodes(
      produce<Record<string, true>>((state) => {
        for (const id of Object.keys(state)) {
          if (!nodes[id]) delete state[id]
        }
      }),
    )
  })

  const treeRootNodes = createMemo(() => sortRootNodes(rootIds(), nodesById()))
  const rootIdsKey = createMemo(() => rootIds().join("\0"))

  const rowsState = createProgressiveRows()
  const visibleRows = rowsState.rows
  const queuedChildIdsByParent = new Map<string, Set<string>>()

  const revealChildRows = (nodeId: string | null) => {
    if (!nodeId) return
    if (mode() !== "default") return
    if (!isExpanded(nodeId)) return
    const parent = getNode(nodeId)
    if (!parent?.hasChildren) return
    if (!findRow(visibleRows(), nodeId)) return

    const ids = getLoadedChildIds(nodeId)
    const visibleIds = getVisibleChildIds(visibleRows(), nodeId)
    const queuedIds = queuedChildIdsByParent.get(nodeId) ?? new Set<string>()
    queuedChildIdsByParent.set(nodeId, queuedIds)
    const missingIds = ids.filter((id) => !visibleIds.includes(id) && !queuedIds.has(id))
    if (missingIds.length === 0) return
    for (const id of missingIds) {
      queuedIds.add(id)
    }

    const afterId = visibleIds[visibleIds.length - 1] ?? nodeId
    rowsState.push(
      buildRevealBatch(
        nodeId,
        afterId,
        getRowDepth(visibleRows(), nodeId) + 1,
        missingIds,
        getLoadedChildIds,
        isExpanded,
        () => {
          const current = queuedChildIdsByParent.get(nodeId)
          if (!current) return
          for (const id of missingIds) {
            current.delete(id)
          }
          if (current.size === 0) {
            queuedChildIdsByParent.delete(nodeId)
          }
        },
      ),
    )
  }

  createComputed(
    on([mode, rootIdsKey], () => {
      if (mode() !== "default") return
      rowsState.reset(
        buildRevealBatch(
          null,
          null,
          0,
          treeRootNodes().map((node) => node.id),
          getLoadedChildIds,
          isExpanded,
        ),
      )
    }),
  )

  createComputed(
    on([mode, filter, filteredNodeIds], () => {
      if (mode() !== "search") return
      rowsState.replace(filteredNodeIds().map((id) => ({ id, depth: 0 })))
    }),
  )

  const indexByID = createMemo(() => {
    const map = new Map<string, number>()
    const rows = visibleRows()
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]
      if (!row) continue
      map.set(row.id, index)
    }
    return map
  })

  const selectedRow = createMemo(() => {
    const id = selectedId()
    if (!id) return null
    const index = indexByID().get(id)
    if (index === undefined) return null
    return visibleRows()[index] ?? null
  })

  createComputed(() => {
    const next = normalizeSelectedId(selectedId(), visibleRows(), indexByID())
    if (next === selectedId()) return
    setSelectedId(next)
  })

  const selectNode = (nodeId: string | null) => setSelectedId(nodeId)

  const expandNode = (nodeId: string | null) => {
    if (!nodeId) return
    const node = getNode(nodeId)
    if (!node?.hasChildren) return
    if (isExpanded(nodeId)) return
    setExpandedNodes(nodeId, true)
    revealChildRows(nodeId)
    const missingIds = node.childIds.filter((childId) => !getNode(childId))
    if (missingIds.length === 0) return
    void options.introspection.ensureNodes(missingIds).then(() => {
      revealChildRows(nodeId)
    })
  }

  const collapseNode = (nodeId: string | null) => {
    if (!nodeId) return
    if (!isExpanded(nodeId)) return
    queuedChildIdsByParent.delete(nodeId)
    rowsState.removeSubtree(nodeId)
    setExpandedNodes(
      produce((state) => {
        delete state[nodeId]
      }),
    )
  }

  const moveSelection = (delta: number) => {
    selectNode(moveSelectedId(selectedId(), delta, visibleRows(), indexByID()))
  }

  const focusFirstChild = () => {
    const row = selectedRow()
    if (!row) return
    const node = getNode(row.id)
    if (!node?.hasChildren) return
    const firstChildId = getLoadedChildIds(row.id)[0]
    if (!firstChildId) return
    batch(() => {
      expandNode(row.id)
      selectNode(firstChildId)
    })
  }

  const collapseCurrentOrParent = () => {
    const row = selectedRow()
    if (!row) return
    const node = getNode(row.id)
    if (node?.hasChildren && isExpanded(row.id)) {
      collapseNode(row.id)
      return
    }
    if (!row.parentId) return
    const parentId = row.parentId
    batch(() => {
      collapseNode(parentId)
      selectNode(parentId)
    })
  }

  const activateSelection = () => {
    const row = selectedRow()
    if (!row) return
    const node = getNode(row.id)
    if (!node?.hasChildren) return
    if (isExpanded(row.id)) {
      collapseNode(row.id)
      return
    }
    expandNode(row.id)
  }

  const refreshGraph = async () => {
    await options.introspection.refresh()
  }

  return {
    isFocused: options.isFocused,
    focusSelf: options.focusSelf,
    loading,
    error,
    refreshGraph,
    mode,
    setMode: setUIMode,
    filter,
    setFilter,
    visibleRows,
    selectedId,
    selectedRow,
    moveSelection,
    focusFirstChild,
    collapseCurrentOrParent,
    activateSelection,
    getNode,
    isExpanded,
    selectNode,
    collapseNode,
    expandNode,
  }
}

export type ExplorerViewModel = ReturnType<typeof createVM>

/**
 * Introspection already hydrates nodes incrementally, but expanding a node with
 * thousands of children still freezes the TUI if we mount every row in one turn.
 * Keep display incremental too, so large branches become interactive immediately.
 */
function createProgressiveRows() {
  const [rows, setRows] = createSignal<VisibleRow[]>([])
  const stack: ActiveRevealBatch[] = []
  let revealTimeoutHandle: ReturnType<typeof setTimeout> | null = null

  const clearSchedule = () => {
    if (revealTimeoutHandle === null) return
    clearTimeout(revealTimeoutHandle)
    revealTimeoutHandle = null
  }

  const disposeBatch = (batch: RevealBatch) => {
    batch.onFinish?.()
  }

  const disposeStack = () => {
    for (const active of stack) {
      disposeBatch(active.batch)
    }
    stack.length = 0
  }

  const scheduleNextReveal = () => {
    if (revealTimeoutHandle !== null) return
    revealTimeoutHandle = setTimeout(processReveal, 10)
  }

  const push = (batch: RevealBatch) => {
    if (batch.rows.length === 0) return
    stack.push({
      afterId: batch.afterId,
      batch,
      nextIndex: 0,
    })
    processReveal()
  }

  const processReveal = () => {
    revealTimeoutHandle = null
    const next = applyRevealStep(rows(), stack)
    stack.splice(0, stack.length, ...next.stack)
    setRows(next.rows)

    if (stack.length > 0) {
      scheduleNextReveal()
    }
  }

  const reset = (batch: RevealBatch) => {
    clearSchedule()
    disposeStack()
    setRows([])
    push(batch)
  }

  const replace = (nextRows: VisibleRow[]) => {
    clearSchedule()
    disposeStack()
    setRows(nextRows)
  }

  const removeSubtree = (nodeId: string) => {
    clearSchedule()
    const current = rows()
    const range = getSubtreeRange(current, nodeId)
    if (!range) return
    const removedIds = new Set(current.slice(range.start, range.end).map((row) => row.id))
    setRows([...current.slice(0, range.start), ...current.slice(range.end)])

    for (let index = stack.length - 1; index >= 0; index -= 1) {
      const active = stack[index]
      if (!active) continue
      if (!active.batch.parentId) continue
      if (active.batch.parentId !== nodeId && !removedIds.has(active.batch.parentId)) continue
      disposeBatch(active.batch)
      stack.splice(index, 1)
    }

    if (stack.length > 0) {
      scheduleNextReveal()
    }
  }

  onCleanup(() => {
    clearSchedule()
    disposeStack()
  })

  return {
    push,
    removeSubtree,
    replace,
    reset,
    rows,
  }
}

type ActiveRevealBatch = {
  afterId: string | null
  batch: RevealBatch
  nextIndex: number
}

export function applyRevealStep(
  currentRows: VisibleRow[],
  currentStack: ActiveRevealBatch[],
  batchSize = CHILD_BATCH_SIZE,
) {
  const stack = currentStack.slice()
  const active = stack[stack.length - 1]
  if (!active) {
    return { rows: currentRows, stack }
  }

  const current = {
    afterId: active.afterId,
    batch: active.batch,
    nextIndex: active.nextIndex,
  }
  stack[stack.length - 1] = current

  const rows = currentRows.slice()
  const insertedBatches: RevealBatch[] = []
  const limit = Math.min(current.batch.rows.length, current.nextIndex + batchSize)

  for (let index = current.nextIndex; index < limit; index += 1) {
    const row = current.batch.rows[index]
    if (!row) continue
    const insertAt = getInsertIndex(rows, current.afterId)
    rows.splice(insertAt, 0, row)
    current.afterId = row.id
    const childBatch = current.batch.childBatches[row.id]
    if (childBatch) insertedBatches.push(childBatch)
  }

  current.nextIndex = limit

  if (current.nextIndex >= current.batch.rows.length) {
    stack.pop()
    current.batch.onFinish?.()
  }

  for (let index = insertedBatches.length - 1; index >= 0; index -= 1) {
    const batch = insertedBatches[index]
    if (!batch) continue
    stack.push({ afterId: batch.afterId, batch, nextIndex: 0 })
  }

  return { rows, stack }
}

function buildRevealBatch(
  parentId: string | null,
  afterId: string | null,
  depth: number,
  ids: string[],
  getChildIds: (nodeId: string | null) => string[],
  isExpanded: (nodeId: string | null) => boolean,
  onFinish?: () => void,
): RevealBatch {
  const rows = ids.map((id) => ({
    id,
    parentId: parentId ?? undefined,
    depth,
  }))
  const childBatches: Record<string, RevealBatch> = {}

  for (const id of ids) {
    if (!isExpanded(id)) continue
    const childIds = getChildIds(id)
    if (childIds.length === 0) continue
    childBatches[id] = buildRevealBatch(id, id, depth + 1, childIds, getChildIds, isExpanded)
  }

  return {
    afterId,
    childBatches,
    onFinish,
    parentId,
    rows,
  }
}

function getVisibleChildIds(rows: VisibleRow[], parentId: string) {
  const row = findRow(rows, parentId)
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

function getInsertIndex(rows: VisibleRow[], afterId: string | null) {
  if (!afterId) return 0
  const range = getRowRange(rows, afterId)
  if (!range) return rows.length
  return range.end
}

function getRowDepth(rows: VisibleRow[], rowId: string) {
  const row = findRow(rows, rowId)
  if (!row) return 0
  return row.row.depth
}

function getSubtreeRange(rows: VisibleRow[], nodeId: string) {
  const range = getRowRange(rows, nodeId)
  if (!range) return null
  return {
    end: range.end,
    start: range.start + 1,
  }
}

function getRowRange(rows: VisibleRow[], rowId: string) {
  const match = findRow(rows, rowId)
  if (!match) return null

  let end = match.index + 1
  for (; end < rows.length; end += 1) {
    const row = rows[end]
    if (!row) continue
    if (row.depth <= match.row.depth) break
  }

  return {
    end,
    start: match.index,
  }
}

function findRow(rows: VisibleRow[], rowId: string) {
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    if (!row) continue
    if (row.id !== rowId) continue
    return { index, row }
  }
  return null
}

function sortRootNodes(rootIds: string[], nodesById: Record<string, ExplorerNode>) {
  const nodes = rootIds.map((id) => nodesById[id]).filter((node): node is ExplorerNode => Boolean(node))
  nodes.sort((left, right) => {
    const leftNode = getSnapshotNode(left)
    const rightNode = getSnapshotNode(right)
    const leftDefault = isDefaultRoot(leftNode)
    const rightDefault = isDefaultRoot(rightNode)

    if (leftDefault !== rightDefault) {
      return leftDefault ? -1 : 1
    }

    const byName = (leftNode?.name ?? "").toLocaleLowerCase().localeCompare((rightNode?.name ?? "").toLocaleLowerCase())
    if (byName !== 0) {
      return byName
    }

    return left.id.localeCompare(right.id)
  })
  return nodes
}

function getSnapshotNode(node: ExplorerNode | undefined) {
  if (!node) return undefined
  if (node.kind !== "node") return undefined
  return node.node
}

function isDefaultRoot(node?: Node): boolean {
  if (!node) return false
  if (node.type !== NodeType.DATABASE && node.type !== NodeType.SCHEMA) return false
  return node.attributes.isDefault
}

export function buildRows(
  rootIds: readonly string[],
  getHasChildren: (nodeId: string) => boolean,
  getChildIds: (nodeId: string) => string[],
) {
  const rows: VisibleRow[] = []
  for (const rootId of rootIds) {
    rows.push({ id: rootId, depth: 0 })
    if (!getHasChildren(rootId)) continue
    appendRows(rows, rootId, 1, getHasChildren, getChildIds)
  }
  return rows
}

function appendRows(
  rows: VisibleRow[],
  parentId: string,
  depth: number,
  getHasChildren: (nodeId: string) => boolean,
  getChildIds: (nodeId: string) => string[],
) {
  for (const childId of getChildIds(parentId)) {
    rows.push({ id: childId, depth, parentId })
    if (!getHasChildren(childId)) continue
    appendRows(rows, childId, depth + 1, getHasChildren, getChildIds)
  }
}

export function normalizeSelectedId(current: string | null, rows: VisibleRow[], rowIndexMap: Map<string, number>) {
  if (!rows.length) return current
  if (!current) return rows[0]?.id ?? null
  if (rowIndexMap.has(current)) return current
  return current
}

export function moveSelectedId(
  current: string | null,
  delta: number,
  rows: VisibleRow[],
  rowIndexMap: Map<string, number>,
) {
  if (!rows.length) return null
  const index = current ? (rowIndexMap.get(current) ?? -1) : -1
  const base = index === -1 ? 0 : index
  const next = Math.max(0, Math.min(rows.length - 1, base + delta))
  return rows[next]?.id ?? null
}
