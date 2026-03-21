import type { ResourceIntrospectionUsecase } from "@usecase/introspection/usecase"
import type { Accessor } from "solid-js"
import { batch, createComputed, createMemo, createSignal, onCleanup } from "solid-js"
import { createExplorerGraph } from "./explorer-graph"
import {
  createExplorerRenderedRows,
  type ExplorerRenderedRow,
} from "./explorer-rendered-rows"
import {
  createExplorerRows,
  findExplorerRow,
  moveSelectedId,
  normalizeSelectedId,
  type ExplorerRow,
} from "./explorer-rows"

type CreateVMOptions = {
  introspection: Introspection
  isFocused: Accessor<boolean>
  focusSelf: () => void
}

export type UIMode = "default" | "search"

type Introspection = Pick<ResourceIntrospectionUsecase, "subscribe" | "getState" | "load" | "refresh" | "ensureNodes">

export function createVM(options: CreateVMOptions) {
  const [snapshot, setSnapshot] = createSignal(options.introspection.getState())
  const [mode, setMode] = createSignal("default" as UIMode)
  const [filter, setFilter] = createSignal("")
  const [selectedId, setSelectedId] = createSignal<string | null>(null)

  const unsubscribe = options.introspection.subscribe(() => {
    setSnapshot(options.introspection.getState())
  })

  onCleanup(() => {
    unsubscribe()
  })

  void options.introspection.load()

  const graph = createMemo(() =>
    createExplorerGraph({
      nodesById: snapshot().nodesById,
      rootIds: snapshot().rootIds,
    }),
  )
  const rowsState = createExplorerRows({
    graph,
    mode,
    filter,
  })
  const getNode = (nodeId: string | null) => (nodeId ? graph().nodesById[nodeId] : undefined)
  const isExpanded = (nodeId: string | null) => rowsState.isExpanded(nodeId)
  const rows = rowsState.rows
  const change = createMemo(() => rowsState.change())
  const renderedRowsState = createExplorerRenderedRows({ change })
  const visibleRows = renderedRowsState.rows

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

  const selectedRow = createMemo(() => {
    const id = selectedId()
    if (!id) return null
    const index = indexById().get(id)
    if (index === undefined) return null
    return rows()[index] ?? null
  })

  createComputed(() => {
    const next = normalizeSelectedId(selectedId(), rows(), indexById())
    if (next === selectedId()) return
    setSelectedId(next)
  })

  const selectNode = (nodeId: string | null) => setSelectedId(nodeId)
  const setUIMode = (next: UIMode) => setMode(next)

  const expandNode = (nodeId: string | null) => {
    if (!nodeId) return
    const node = getNode(nodeId)
    if (!node?.hasChildren) return
    if (isExpanded(nodeId)) return
    rowsState.expandNode(nodeId)
    const missingIds = node.childIds.filter((childId) => !getNode(childId))
    if (missingIds.length === 0) return
    void options.introspection.ensureNodes(missingIds)
  }

  const collapseNode = (nodeId: string | null) => {
    if (!nodeId) return
    if (!isExpanded(nodeId)) return
    rowsState.collapseNode(nodeId)
  }

  const moveSelection = (delta: number) => {
    selectNode(moveSelectedId(selectedId(), delta, rows(), indexById()))
  }

  const focusFirstChild = () => {
    const row = selectedRow()
    if (!row?.hasChildren) return
    const childId = row.childIds[0]
    if (!childId) return
    batch(() => {
      expandNode(row.id)
      selectNode(childId)
    })
  }

  const collapseCurrentOrParent = () => {
    const row = selectedRow()
    if (!row) return
    if (row.hasChildren && row.isExpanded) {
      collapseNode(row.id)
      return
    }
    if (!row.parentId) return
    batch(() => {
      const parentId = row.parentId
      if (!parentId) return
      collapseNode(parentId)
      selectNode(parentId)
    })
  }

  const activateSelection = () => {
    const row = selectedRow()
    if (!row?.hasChildren) return
    if (row.isExpanded) {
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
    loading: () => snapshot().loading,
    error: () => snapshot().error,
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
export type { ExplorerRenderedRow }
export type { ExplorerRow }

export function findVisibleRow(rows: ExplorerRenderedRow[], rowId: string) {
  return findExplorerRow(rows, rowId)
}
