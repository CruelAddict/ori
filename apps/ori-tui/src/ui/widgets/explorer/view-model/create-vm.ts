import type { ResourceIntrospectionUsecase } from "@usecase/introspection/usecase"
import type { Accessor } from "solid-js"
import { batch, createComputed, createMemo, createSignal, onCleanup } from "solid-js"
import type { ExplorerNode as ExplorerNodeState } from "../model/explorer-node"
import { createExplorerGraph } from "./explorer-graph"
import {
  createExplorerRenderedRows,
  type ExplorerRenderedRow as ExplorerRenderedRowState,
} from "./explorer-rendered-rows"
import {
  createExplorerRows,
  type ExplorerRow as ExplorerRowState,
  findExplorerRow,
  moveSelectedId,
  normalizeSelectedId,
} from "./explorer-rows"

type CreateVMOptions = {
  introspection: Introspection
  isFocused: Accessor<boolean>
  focusSelf: () => void
}

export type UIMode = "default" | "search"

type Introspection = Pick<ResourceIntrospectionUsecase, "subscribe" | "getState" | "load" | "refresh" | "ensureNodes">

export type ExplorerNode = {
  readonly id: string
  readonly kind: ExplorerNodeState["kind"]
  readonly label: string
  readonly description?: string
  readonly badges: readonly string[]
  readonly hasChildren: boolean
  readonly childIds: readonly string[]
  isSelected: () => boolean
  isExpanded: () => boolean
  row: () => ExplorerRow | null
  parent: () => ExplorerNode | null
  children: () => ExplorerNode[]
  firstChild: () => ExplorerNode | null
  select: () => void
  expand: () => void
  collapse: () => void
  toggle: () => void
}

export type ExplorerRowElement = {
  text: string
  role: "glyph" | "main" | "description" | "badge"
  attributes?: number
}

export type ExplorerRow = {
  readonly id: string
  readonly depth: number
  readonly width: number
  readonly elements: readonly ExplorerRowElement[]
  readonly hasChildren: boolean
  readonly isExpanded: boolean
  isSelected: () => boolean
  node: () => ExplorerNode
  parent: () => ExplorerRow | null
  children: () => ExplorerRow[]
  firstChild: () => ExplorerRow | null
  select: () => void
  expand: () => void
  collapse: () => void
  toggle: () => void
}

export function createVM(options: CreateVMOptions) {
  const [snapshot, setSnapshot] = createSignal(options.introspection.getState())
  const [mode, setMode] = createSignal("default" as UIMode)
  const [filter, setFilterState] = createSignal("")
  const [defaultSelectedId, setDefaultSelectedId] = createSignal<string | null>(null)
  const [searchSelectedId, setSearchSelectedId] = createSignal<string | null>(null)
  const nodes = new Map<string, ExplorerNode>()
  const rows = new Map<string, ExplorerRow>()

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
  const renderedRowsState = createExplorerRenderedRows(rowsState.change)
  const rowById = createMemo(() => {
    const map = new Map<string, ExplorerRowState>()
    for (const row of rowsState.rows()) {
      map.set(row.id, row)
    }
    return map
  })
  const visibleRowById = createMemo(() => {
    const map = new Map<string, ExplorerRenderedRowState>()
    for (const row of renderedRowsState.rows()) {
      map.set(row.id, row)
    }
    return map
  })
  const indexById = createMemo(() => {
    const map = new Map<string, number>()
    const list = rowsState.rows()
    for (let index = 0; index < list.length; index += 1) {
      const row = list[index]
      if (!row) continue
      map.set(row.id, index)
    }
    return map
  })
  const activeSelectedId = createMemo(() => (mode() === "search" ? searchSelectedId() : defaultSelectedId()))
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
    const next = normalizeSelectedId(defaultSelectedId(), rowsState.rows(), indexById())
    if (next === defaultSelectedId()) return
    setDefaultSelectedId(next)
  })

  createComputed(() => {
    if (mode() !== "search") return
    const list = rowsState.rows()
    const next = normalizeSelectedId(searchSelectedId(), list, indexById(), { preserveHidden: false })
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

  const getNodeState = (nodeId: string | null) => {
    if (!nodeId) return undefined
    return graph().nodesById[nodeId]
  }

  const expandNode = (nodeId: string | null) => {
    if (!nodeId) return
    const node = getNodeState(nodeId)
    if (!node?.hasChildren) return
    if (rowsState.isExpanded(nodeId)) return
    rowsState.expandNode(nodeId)
    const missingIds = node.childIds.filter((childId) => !getNodeState(childId))
    if (missingIds.length === 0) return
    void options.introspection.ensureNodes(missingIds)
  }

  const collapseNode = (nodeId: string | null) => {
    if (!nodeId) return
    if (!rowsState.isExpanded(nodeId)) return
    rowsState.collapseNode(nodeId)
  }

  const toggleNode = (nodeId: string | null) => {
    if (!nodeId) return
    if (rowsState.isExpanded(nodeId)) {
      collapseNode(nodeId)
      return
    }
    expandNode(nodeId)
  }

  const getNode = (nodeId: string) => {
    const cached = nodes.get(nodeId)
    if (cached) return cached
    const node: ExplorerNode = {
      get id() {
        return nodeId
      },
      get kind() {
        return getNodeState(nodeId)?.kind ?? "node"
      },
      get label() {
        return getNodeState(nodeId)?.label ?? ""
      },
      get description() {
        return getNodeState(nodeId)?.description
      },
      get badges() {
        return getNodeState(nodeId)?.badges ?? []
      },
      get hasChildren() {
        return getNodeState(nodeId)?.hasChildren ?? false
      },
      get childIds() {
        return getNodeState(nodeId)?.childIds ?? []
      },
      isSelected: () => selectedId() === nodeId,
      isExpanded: () => rowsState.isExpanded(nodeId),
      row: () => {
        const row = visibleRowById().get(nodeId)
        if (!row) return null
        return getRow(row.id)
      },
      parent: () => {
        const row = rowById().get(nodeId)
        const id = row?.parentId
        if (!id) return null
        return getNode(id)
      },
      children: () => {
        const state = getNodeState(nodeId)
        if (!state) return []
        return state.childIds.filter((id) => Boolean(getNodeState(id))).map(getNode)
      },
      firstChild: () => {
        const state = getNodeState(nodeId)
        const id = state?.childIds.find((childId) => Boolean(getNodeState(childId)))
        if (!id) return null
        return getNode(id)
      },
      select: () => setSelectedId(nodeId),
      expand: () => expandNode(nodeId),
      collapse: () => collapseNode(nodeId),
      toggle: () => toggleNode(nodeId),
    }
    nodes.set(nodeId, node)
    return node
  }

  const getRowState = (rowId: string) => rowById().get(rowId)
  const getVisibleRowState = (rowId: string) => visibleRowById().get(rowId)

  const getRow = (rowId: string) => {
    const cached = rows.get(rowId)
    if (cached) return cached
    const row: ExplorerRow = {
      get id() {
        return rowId
      },
      get depth() {
        return getVisibleRowState(rowId)?.depth ?? getRowState(rowId)?.depth ?? 0
      },
      get width() {
        return getVisibleRowState(rowId)?.width ?? 0
      },
      get elements() {
        return getVisibleRowState(rowId)?.elements ?? []
      },
      get hasChildren() {
        return getRowState(rowId)?.hasChildren ?? getNodeState(rowId)?.hasChildren ?? false
      },
      get isExpanded() {
        return getRowState(rowId)?.isExpanded ?? false
      },
      isSelected: () => selectedId() === rowId,
      node: () => getNode(rowId),
      parent: () => {
        const id = getRowState(rowId)?.parentId ?? getVisibleRowState(rowId)?.parentId
        if (!id) return null
        if (!getVisibleRowState(id) && !getRowState(id)) return null
        return getRow(id)
      },
      children: () => {
        const state = getRowState(rowId)
        if (!state) return []
        return state.childIds.filter((id) => Boolean(getVisibleRowState(id))).map(getRow)
      },
      firstChild: () => {
        const state = getRowState(rowId)
        const id = state?.childIds.find((childId) => Boolean(getVisibleRowState(childId)))
        if (!id) return null
        return getRow(id)
      },
      select: () => setSelectedId(rowId),
      expand: () => expandNode(rowId),
      collapse: () => collapseNode(rowId),
      toggle: () => toggleNode(rowId),
    }
    rows.set(rowId, row)
    return row
  }

  const moveSelection = (delta: number) => {
    setSelectedId(moveSelectedId(selectedId(), delta, rowsState.rows(), indexById()))
  }

  const selectedRow = createMemo(() => {
    const id = selectedId()
    if (!id) return null
    const row = visibleRowById().get(id)
    if (!row) return null
    return getRow(row.id)
  })

  const selectedRowState = createMemo(() => {
    const id = selectedId()
    if (!id) return null
    const index = indexById().get(id)
    if (index === undefined) return null
    return rowsState.rows()[index] ?? null
  })

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

  const visibleRows = createMemo(() => renderedRowsState.rows().map((row) => getRow(row.id)))

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

export function findVisibleRow(rows: ExplorerRow[], rowId: string) {
  return findExplorerRow(rows, rowId)
}

function firstVisibleRowId(rows: ExplorerRowState[]) {
  return rows[0]?.id ?? null
}
