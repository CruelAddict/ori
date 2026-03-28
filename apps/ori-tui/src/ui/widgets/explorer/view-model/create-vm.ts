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
    getRow: rowsState.getRow,
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

  const handleMoveIn = () => {
    const row = selectedRow()?.row
    if (!row?.hasChildren) return
    batch(() => {
      row.expand()
      setSelectedId(row.firstChild()?.id ?? null)
    })
  }

  const handleMoveOut = () => {
    const row = selectedRow()?.row
    if (!row) return
    if (row.hasChildren && row.isExpanded) {
      row.collapse()
      return
    }
    const parent = row.parent()
    if (!parent) return
    batch(() => {
      parent.collapse()
      setSelectedId(parent.id)
    })
  }

  const toggleExpanded = () => {
    const row = selectedRow()?.row
    if (!row?.hasChildren) return
    row.toggle()
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
    moveSelection,
    handleMoveIn,
    handleMoveOut,
    toggleExpanded,
  }
}

export type ExplorerViewModel = ReturnType<typeof createVM>
