import type { ResourceIntrospectionUsecase } from "@usecase/introspection/usecase"
import type { Accessor } from "solid-js"
import { batch, createComputed, createMemo, createSignal, onCleanup } from "solid-js"
import { createExplorerGraph } from "./explorer-graph"
import { createExplorerRenderedRows } from "./explorer-rendered-rows"
import { createExplorerRows, getFirstVisibleRowId, moveVisibleRowId } from "./explorer-rows"
import type { UIMode } from "./explorer-types"

type CreateVMOptions = {
  introspection: Introspection
  isFocused: Accessor<boolean>
  focusSelf: () => void
}

type Introspection = Pick<ResourceIntrospectionUsecase, "subscribe" | "getState" | "load" | "refresh" | "ensureNodes">

export function createVM(options: CreateVMOptions) {
  const [snapshot, setSnapshot] = createSignal(options.introspection.getState())
  const [mode, setMode] = createSignal("tree" as UIMode)
  const [filter, setFilterState] = createSignal("")
  const [treeSelectedId, setTreeSelectedId] = createSignal<string | null>(null)
  const [searchSelectedId, setSearchSelectedId] = createSignal<string | null>(null)

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
    ensureNodes: (ids) => options.introspection.ensureNodes(ids),
  })
  const visibleRows = createExplorerRenderedRows({
    change: rowsState.change,
  })

  const setFilter = (value: string) => {
    setFilterState(value)
    queueMicrotask(() => {
      if (mode() !== "search") return
      setSearchSelectedId(getFirstVisibleRowId(rowsState.rows()))
    })
  }

  createComputed(() => {
    if (mode() !== "search") return
    const current = searchSelectedId()
    const rows = rowsState.rows()
    // Search selection should always stay on a visible match as results change.
    const next = !current || !rowsState.indexById().has(current) ? getFirstVisibleRowId(rows) : current
    if (next === searchSelectedId()) return
    setSearchSelectedId(next)
  })

  const setSelectedId = (nodeId: string | null) => {
    if (mode() === "search") {
      setSearchSelectedId(nodeId)
      return
    }
    setTreeSelectedId(nodeId)
  }

  function selectedId() {
    const id = mode() === "search" ? searchSelectedId() : treeSelectedId()
    return id ?? getFirstVisibleRowId(rowsState.rows())
  }

  const moveSelection = (delta: number) => {
    const current = selectedId()
    const rows = rowsState.rows()
    if (!current) {
      setSelectedId(getFirstVisibleRowId(rows))
      return
    }
    setSelectedId(moveVisibleRowId(current, delta, rows, rowsState.indexById()))
  }

  const selectedRow = createMemo(() => {
    const id = selectedId()
    if (!id) return null
    return visibleRows().find((row) => row.id === id) ?? null
  })

  const rowState = (id: string) => rowsState.getState(id)
  const expandRow = (id: string) => rowsState.expandNode(id)
  const collapseRow = (id: string) => rowsState.collapseNode(id)
  const toggleRow = (id: string) => rowsState.toggleNode(id)

  const handleMoveIn = () => {
    const id = selectedId()
    if (!id) return
    const row = rowsState.getState(id)
    if (!row?.hasChildren) return
    batch(() => {
      rowsState.expandNode(id)
      setSelectedId(rowsState.getFirstChildId(id))
    })
  }

  const handleMoveOut = () => {
    const id = selectedId()
    if (!id) return
    const row = rowsState.getState(id)
    if (!row) return
    if (row.hasChildren && row.isExpanded) {
      rowsState.collapseNode(id)
      return
    }
    const parentId = rowsState.getParentId(id)
    if (!parentId) return
    batch(() => {
      rowsState.collapseNode(parentId)
      setSelectedId(parentId)
    })
  }

  const toggleExpanded = () => {
    const id = selectedId()
    if (!id) return
    const row = rowsState.getState(id)
    if (!row?.hasChildren) return
    rowsState.toggleNode(id)
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
    setMode,
    filter,
    setFilter,
    visibleRows,
    selectedId,
    select: setSelectedId,
    selectedRow,
    rowState,
    expandRow,
    collapseRow,
    toggleRow,
    moveSelection,
    handleMoveIn,
    handleMoveOut,
    toggleExpanded,
  }
}

export type ExplorerViewModel = ReturnType<typeof createVM>
