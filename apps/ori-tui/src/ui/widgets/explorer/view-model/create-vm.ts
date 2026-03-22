import type { ResourceIntrospectionUsecase } from "@usecase/introspection/usecase"
import type { Accessor } from "solid-js"
import { batch, createComputed, createMemo, createSignal, onCleanup } from "solid-js"
import { createExplorerGraph } from "./explorer-graph"
import { createExplorerRenderedRows, type ExplorerRenderedRow } from "./explorer-rendered-rows"
import { createExplorerRows } from "./explorer-rows"
import type { UIMode } from "./explorer-types"

type CreateVMOptions = {
  introspection: Introspection
  isFocused: Accessor<boolean>
  focusSelf: () => void
}

type Introspection = Pick<ResourceIntrospectionUsecase, "subscribe" | "getState" | "load" | "refresh" | "ensureNodes">

export function createVM(options: CreateVMOptions) {
  const [snapshot, setSnapshot] = createSignal(options.introspection.getState())
  const [mode, setMode] = createSignal("default" as UIMode)
  const [filter, setFilterState] = createSignal("")
  const [defaultSelectedId, setDefaultSelectedId] = createSignal<string | null>(null)
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
    isSelected: (id) => selectedId() === id,
    select: (id) => setSelectedId(id),
    ensureNodes: (ids) => options.introspection.ensureNodes(ids),
  })
  const renderedRowsState = createExplorerRenderedRows({
    change: rowsState.change,
    getRow: rowsState.getRow,
  })

  const setFilter = (value: string) => {
    setFilterState(value)
    queueMicrotask(() => {
      if (mode() !== "search") return
      const firstVisibleRowId = rowsState.rows()[0]?.id ?? null
      setSearchSelectedId(firstVisibleRowId)
    })
  }

  createComputed(() => {
    if (mode() !== "default") return
    const next = rowsState.normalizeId(defaultSelectedId())
    if (next === defaultSelectedId()) return
    setDefaultSelectedId(next)
  })

  createComputed(() => {
    if (mode() !== "search") return
    const next = rowsState.normalizeId(searchSelectedId(), { preserveHidden: false })
    if (next === searchSelectedId()) return
    setSearchSelectedId(next)
  })

  const setSelectedId = (nodeId: string | null) => {
    if (mode() === "search") {
      setSearchSelectedId(nodeId)
      return
    }
    setDefaultSelectedId(nodeId)
  }

  function selectedId() {
    const id = mode() === "search" ? searchSelectedId() : defaultSelectedId()
    return id ?? rowsState.rows()[0]?.id ?? null
  }

  const moveSelection = (delta: number) => {
    setSelectedId(rowsState.moveId(selectedId(), delta))
  }

  const selectedRow = createMemo(() => renderedRowsState.getRow(selectedId()))

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

  const visibleRows = createMemo(() =>
    renderedRowsState
      .rows()
      .map((row) => renderedRowsState.getRow(row.id))
      .filter((row): row is ExplorerRenderedRow => Boolean(row)),
  )

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
    selectedRow,
    moveSelection,
    handleMoveIn,
    handleMoveOut,
    toggleExpanded,
  }
}

export type ExplorerViewModel = ReturnType<typeof createVM>
