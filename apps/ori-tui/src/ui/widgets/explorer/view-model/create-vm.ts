import { type Node, NodeType } from "@adapters/ori/client"
import type { ResourceIntrospectionUsecase } from "@usecase/introspection/usecase"
import type { Accessor } from "solid-js"
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { createExplorerGraph } from "../model/explorer-graph"

type Introspection = Pick<ResourceIntrospectionUsecase, "subscribe" | "getState" | "load" | "refresh">

type CreateVMOptions = {
  introspection: Introspection
  isFocused: Accessor<boolean>
  focusSelf: () => void
}

export type UIMode = "default" | "search"

export function createVM(options: CreateVMOptions) {
  const [nodesByIdState, setNodesByIdState] = createSignal(options.introspection.getState().nodesById)
  const [rootIdsState, setRootIdsState] = createSignal(options.introspection.getState().rootIds)
  const [loadingState, setLoadingState] = createSignal(options.introspection.getState().loading)
  const [errorState, setErrorState] = createSignal(options.introspection.getState().error)
  const [mode, setMode] = createSignal("default" as UIMode)
  const [filter, setFilter] = createSignal("")

  const unsubscribe = options.introspection.subscribe(() => {
    setNodesByIdState(options.introspection.getState().nodesById)
    setRootIdsState(options.introspection.getState().rootIds)
    setLoadingState(options.introspection.getState().loading)
    setErrorState(options.introspection.getState().error)
  })

  onCleanup(() => {
    unsubscribe()
  })

  createEffect(() => {
    void options.introspection.load()
  })

  const nodesById = createMemo(() => nodesByIdState())
  const rootIds = createMemo(() => {
    const ids = [...rootIdsState()]
    const nodes = nodesById()
    ids.sort((leftId, rightId) => compareRootIds(leftId, rightId, nodes[leftId], nodes[rightId]))
    return ids
  })
  const loading = createMemo(() => loadingState())
  const error = createMemo(() => errorState())

  const graph = createExplorerGraph(nodesById, rootIds)

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
    rootIds: graph.rootIds,
    visibleRows: graph.visibleRows,
    selectedId: graph.selectedId,
    moveSelection: graph.moveSelection,
    focusFirstChild: graph.focusFirstChild,
    collapseCurrentOrParent: graph.collapseCurrentOrParent,
    activateSelection: graph.activateSelection,
    getEntity: graph.getEntity,
    getRenderableChildIds: graph.getRenderableChildIds,
    isExpanded: graph.isExpanded,
    selectNode: graph.selectNode,
    collapseNode: graph.collapseNode,
    expandNode: graph.expandNode,
  }
}

export type ExplorerViewModel = ReturnType<typeof createVM>

function compareRootIds(leftId: string, rightId: string, leftNode?: Node, rightNode?: Node): number {
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
}

function isDefaultRoot(node?: Node): boolean {
  if (!node) return false
  if (node.type !== NodeType.DATABASE && node.type !== NodeType.SCHEMA) return false
  return node.attributes.isDefault
}
