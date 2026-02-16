import { useResourceIntrospection } from "@entities/resource-introspection/model/resource-introspector"
import { type Node, NodeType } from "@shared/lib/resources-client"
import type { Accessor } from "solid-js"
import { createEffect, createMemo } from "solid-js"
import { createTreePaneGraph } from "./tree-pane-graph"

export type TreePaneViewModel = {
  controller: ReturnType<typeof createTreePaneGraph>
  isFocused: Accessor<boolean>
  loading: Accessor<boolean>
  error: Accessor<string | null>
  focusSelf: () => void
  refreshGraph: () => Promise<void>
}

type CreateTreePaneModelOptions = {
  resourceName: Accessor<string>
  isFocused: Accessor<boolean>
  focusSelf: () => void
}

export function createTreePaneModel(options: CreateTreePaneModelOptions): TreePaneViewModel {
  const introspection = useResourceIntrospection()

  createEffect(() => {
    void introspection.ensureLoaded(options.resourceName())
  })

  const nodesById = createMemo(() => introspection.getNodesById(options.resourceName()))
  const rootIds = createMemo(() => {
    const ids = [...introspection.getRootIds(options.resourceName())]
    const nodes = nodesById()
    ids.sort((leftId, rightId) => compareRootIds(leftId, rightId, nodes[leftId], nodes[rightId]))
    return ids
  })
  const loading = createMemo(() => introspection.isLoading(options.resourceName()))
  const error = createMemo(() => introspection.getError(options.resourceName()))

  const controller = createTreePaneGraph(nodesById, rootIds)

  const refreshGraph = async () => {
    await introspection.refresh(options.resourceName())
  }

  return {
    controller,
    isFocused: options.isFocused,
    focusSelf: options.focusSelf,
    loading,
    error,
    refreshGraph,
  }
}

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
