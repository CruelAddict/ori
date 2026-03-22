import type { ResourceIntrospectionUsecase } from "@usecase/introspection/usecase"
import type { Accessor } from "solid-js"
import { batch, createComputed, createMemo, createSignal, onCleanup } from "solid-js"
import { createExplorerGraph } from "./explorer-graph"
import { createExplorerRenderedRows, type ExplorerRenderedRow } from "./explorer-rendered-rows"
import { createExplorerRows, findExplorerRow } from "./explorer-rows"
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

  const activeSelectedId = createMemo(() => (mode() === "search" ? searchSelectedId() : defaultSelectedId()))
  const rowsState = createExplorerRows({
    graph,
    mode,
    filter,
    isSelected: (id) => activeSelectedId() === id,
    select: (id) => setSelectedId(id),
  })
  const renderedRowsState = createExplorerRenderedRows({
    change: rowsState.change,
    getRow: rowsState.getRow,
  })
  const selectedId = createMemo(() => activeSelectedId() ?? rowsState.rows()[0]?.id ?? null)

  const setFilter = (value: string) => {
    setFilterState(value)
    queueMicrotask(() => {
      if (mode() !== "search") return
      setSearchSelectedId(firstVisibleRowId(rowsState.rows()))
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

  const expandNode = (nodeId: string | null) => {
    if (!nodeId) return
    const node = graph().nodesById[nodeId]
    if (!node?.hasChildren) return
    if (rowsState.isExpanded(nodeId)) return
    rowsState.expandNode(nodeId)
    const missingIds = node.childIds.filter((childId) => !graph().nodesById[childId])
    if (missingIds.length === 0) return
    void options.introspection.ensureNodes(missingIds)
  }

  const collapseNode = (nodeId: string | null) => {
    if (!nodeId) return
    if (!rowsState.isExpanded(nodeId)) return
    rowsState.collapseNode(nodeId)
  }

  const selectedRowState = createMemo(() => {
    return rowsState.getState(selectedId())
  })

  const moveSelection = (delta: number) => {
    setSelectedId(rowsState.moveId(selectedId(), delta))
  }

  const selectedRow = createMemo(() => renderedRowsState.getRow(selectedId()))

  const focusFirstChild = () => {
    const row = selectedRowState()
    if (!row?.hasChildren) return
    const childId = row.childIds[0]
    if (!childId) return
    batch(() => {
      expandNode(row.id)
      setSelectedId(childId)
    })
  }

  const collapseCurrentOrParent = () => {
    const row = selectedRowState()
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
      setSelectedId(parentId)
    })
  }

  const activateSelection = () => {
    const row = selectedRowState()
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
    focusFirstChild,
    collapseCurrentOrParent,
    activateSelection,
  }
}

export type ExplorerViewModel = ReturnType<typeof createVM>

export function findVisibleRow<Row extends { id: string }>(rows: Row[], rowId: string) {
  return findExplorerRow(rows, rowId)
}

function firstVisibleRowId(rows: Array<{ id: string }>) {
  return rows[0]?.id ?? null
}
