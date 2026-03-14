import { type Node, NodeType } from "@adapters/ori/client"
import type { ResourceIntrospectionUsecase } from "@usecase/introspection/usecase"
import type { Accessor } from "solid-js"
import { batch, createComputed, createMemo, createSignal, onCleanup } from "solid-js"
import { createStore, produce } from "solid-js/store"
import type { ExplorerNode } from "../model/explorer-node"
import { createExplorerNodesById } from "./explorer-graph"

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

  const treeRootIds = createMemo(() => sortRootIds(rootIds(), getNode))

  const getChildIds = (nodeId: string | null) => {
    const node = getNode(nodeId)
    if (!node) return []
    return node.childIds.filter((childId) => Boolean(getNode(childId)))
  }

  const getTreeChildIds = (nodeId: string) => {
    if (!isExpanded(nodeId)) return []
    return getChildIds(nodeId)
  }

  const treeRows = createMemo(() => buildTreeRows(treeRootIds(), getNode, isExpanded, getTreeChildIds))
  const visibleRows = createMemo(() => {
    if (mode() === "search") {
      return treeRows()
    }
    return treeRows()
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
    const firstChildId = getChildIds(row.id)[0]
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
    treeRootIds,
    treeRows,
    visibleRows,
    selectedId,
    selectedRow,
    moveSelection,
    focusFirstChild,
    collapseCurrentOrParent,
    activateSelection,
    getNode,
    getTreeChildIds,
    isExpanded,
    selectNode,
    collapseNode,
    expandNode,
  }
}

export type ExplorerViewModel = ReturnType<typeof createVM>

function sortRootIds(rootIds: string[], getNode: (nodeId: string | null) => ExplorerNode | undefined) {
  const ids = [...rootIds]
  ids.sort((leftId, rightId) => {
    const leftNode = getSnapshotNode(getNode(leftId))
    const rightNode = getSnapshotNode(getNode(rightId))
    const leftDefault = isDefaultRoot(leftNode)
    const rightDefault = isDefaultRoot(rightNode)

    if (leftDefault !== rightDefault) {
      return leftDefault ? -1 : 1
    }

    const byName = (leftNode?.name ?? "").toLocaleLowerCase().localeCompare((rightNode?.name ?? "").toLocaleLowerCase())
    if (byName !== 0) {
      return byName
    }

    return leftId.localeCompare(rightId)
  })
  return ids
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

export function buildTreeRows(
  rootIds: readonly string[],
  getNode: (nodeId: string | null) => { id: string; hasChildren: boolean } | undefined,
  isExpanded: (nodeId: string | null) => boolean,
  getTreeChildIds: (nodeId: string) => string[],
) {
  const rows: VisibleRow[] = []
  for (const rootId of rootIds) {
    const node = getNode(rootId)
    if (!node) continue
    rows.push({ id: node.id, depth: 0 })
    if (!node.hasChildren || !isExpanded(node.id)) continue
    appendTreeRows(rows, node.id, 1, getNode, isExpanded, getTreeChildIds)
  }
  return rows
}

function appendTreeRows(
  rows: VisibleRow[],
  parentId: string,
  depth: number,
  getNode: (nodeId: string | null) => { id: string; hasChildren: boolean } | undefined,
  isExpanded: (nodeId: string | null) => boolean,
  getTreeChildIds: (nodeId: string) => string[],
) {
  for (const childId of getTreeChildIds(parentId)) {
    const node = getNode(childId)
    if (!node) continue
    rows.push({ id: node.id, depth, parentId })
    if (!node.hasChildren || !isExpanded(node.id)) continue
    appendTreeRows(rows, node.id, depth + 1, getNode, isExpanded, getTreeChildIds)
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
