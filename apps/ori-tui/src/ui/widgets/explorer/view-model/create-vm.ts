import { type Node, NodeType } from "@adapters/ori/client"
import type { ResourceIntrospectionUsecase } from "@usecase/introspection/usecase"
import type { Accessor } from "solid-js"
import { batch, createComputed, createMemo, createSignal, on, onCleanup } from "solid-js"
import { createStore, produce } from "solid-js/store"
import type { ExplorerNode } from "../model/explorer-node"
import { createExplorerNodesById } from "./explorer-graph"

const CHILD_BATCH_SIZE = 10

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

  const getLoadedChildIds = (nodeId: string | null) => {
    const node = getNode(nodeId)
    if (!node) return []
    return node.childIds.filter((childId) => Boolean(getNode(childId)))
  }

  const treeRowsState = createIterativeRows({
    getTopLevelIds: () => treeRootNodes().map((node) => node.id),
    getChildIds: (nodeId) => {
      if (!isExpanded(nodeId)) return []
      return getNode(nodeId)?.childIds ?? []
    },
    getHasChildren: (nodeId) => Boolean(getNode(nodeId)?.hasChildren),
    isReady: (nodeId) => Boolean(getNode(nodeId)),
    resetKey: () => rootIds().join("\0"),
  })

  const visibleRows = createMemo(() => {
    if (mode() === "search") {
      return treeRowsState.rows()
    }
    return treeRowsState.rows()
  })

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
    treeRowsState.beginChildReveal(nodeId)
    const missingIds = node.childIds.filter((childId) => !getNode(childId))
    if (missingIds.length === 0) return
    void options.introspection.ensureNodes(missingIds)
  }

  const collapseNode = (nodeId: string | null) => {
    if (!nodeId) return
    if (!isExpanded(nodeId)) return
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
    setMode,
    filter,
    setFilter,
    treeRootIds: treeRowsState.getTopLevelIds,
    visibleRows,
    selectedId,
    selectedRow,
    moveSelection,
    focusFirstChild,
    collapseCurrentOrParent,
    activateSelection,
    getNode,
    getTreeChildIds: treeRowsState.getChildIds,
    isExpanded,
    selectNode,
    collapseNode,
    expandNode,
  }
}

export type ExplorerViewModel = ReturnType<typeof createVM>

type CreateIterativeRowsOptions = {
  getTopLevelIds: Accessor<string[]>
  getChildIds: (nodeId: string) => string[]
  getHasChildren: (nodeId: string) => boolean
  isReady: (nodeId: string) => boolean
  resetKey: Accessor<string>
}

/**
 * Introspection already hydrates nodes incrementally, but expanding a node with
 * thousands of children still freezes the TUI if we mount every row in one turn.
 * Keep display incremental too, so large branches become interactive immediately.
 */
function createIterativeRows(options: CreateIterativeRowsOptions) {
  const [topLevelCount, setTopLevelCount] = createSignal(0)
  const [childCounts, setChildCounts] = createStore<Record<string, number>>({})
  const nodesWithPendingChildren = new Set<string>()
  let revealTimeoutHandle: ReturnType<typeof setTimeout> | null = null

  const clearSchedule = () => {
    if (revealTimeoutHandle === null) return
    clearTimeout(revealTimeoutHandle)
    revealTimeoutHandle = null
  }

  const reset = () => {
    clearSchedule()
    nodesWithPendingChildren.clear()
    setTopLevelCount(0)
    setChildCounts({})
  }

  const revealNextTopLevelBatch = () => {
    const ids = options.getTopLevelIds()
    const current = topLevelCount()
    if (current >= ids.length) return false
    setTopLevelCount(Math.min(ids.length, current + CHILD_BATCH_SIZE))
    return topLevelCount() < ids.length
  }

  const revealNextChildBatch = (nodeId: string) => {
    const ids = options.getChildIds(nodeId)
    const current = childCounts[nodeId] ?? 0
    if (current >= ids.length) return false
    setChildCounts(nodeId, Math.min(ids.length, current + CHILD_BATCH_SIZE))
    return (childCounts[nodeId] ?? 0) < ids.length
  }

  const processRevealQueue = () => {
    revealTimeoutHandle = null

    const hasMoreTopLevel = revealNextTopLevelBatch()

    const completed = new Set<string>()
    for (const nodeId of nodesWithPendingChildren) {
      if (!options.getHasChildren(nodeId)) {
        completed.add(nodeId)
        continue
      }
      if (!revealNextChildBatch(nodeId)) {
        completed.add(nodeId)
      }
    }
    for (const nodeId of completed) {
      nodesWithPendingChildren.delete(nodeId)
    }

    if (hasMoreTopLevel || nodesWithPendingChildren.size > 0) {
      revealTimeoutHandle = setTimeout(processRevealQueue, 0)
    }
  }

  const scheduleNextReveal = () => {
    if (revealTimeoutHandle !== null) return
    revealTimeoutHandle = setTimeout(processRevealQueue, 0)
  }

  const beginRootReveal = () => {
    revealNextTopLevelBatch()
    if (topLevelCount() < options.getTopLevelIds().length) {
      scheduleNextReveal()
    }
  }

  const beginChildReveal = (nodeId: string) => {
    if (!options.getHasChildren(nodeId)) return
    revealNextChildBatch(nodeId)
    if ((childCounts[nodeId] ?? 0) < options.getChildIds(nodeId).length) {
      nodesWithPendingChildren.add(nodeId)
    }
    if (nodesWithPendingChildren.size > 0) {
      scheduleNextReveal()
    }
  }

  const getTopLevelVisibleIds = createMemo(
    () => options
      .getTopLevelIds()
      .slice(0, topLevelCount())
      .filter(options.isReady)
  )

  const getVisibleChildIds = (nodeId: string) => {
    const count = childCounts[nodeId] ?? 0
    return options.getChildIds(nodeId).slice(0, count).filter(options.isReady)
  }

  const rows = createMemo(() => buildRows(getTopLevelVisibleIds(), options.getHasChildren, getVisibleChildIds))

  createComputed(on(options.resetKey, () => {
    reset()
    beginRootReveal()
  }))
  onCleanup(() => {
    clearSchedule()
  })

  return {
    rows,
    getTopLevelIds: getTopLevelVisibleIds,
    getChildIds: getVisibleChildIds,
    beginRootReveal,
    beginChildReveal,
  }
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
  if (!rows.length) return null
  if (!current) return rows[0]?.id ?? null
  if (rowIndexMap.has(current)) return current
  return rows[0]?.id ?? null
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
