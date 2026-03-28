import type { Node } from "@adapters/ori/client"
import { convertToExplorerNodes, type ExplorerNode } from "./explorer-node"

export type ExplorerGraph = {
  nodesById: Record<string, ExplorerNode>
  rootIds: string[]
  searchable: Array<{ id: string; name: string }>
}

export function createExplorerGraph(snapshot: { nodesById: Record<string, Node>; rootIds: string[] }): ExplorerGraph {
  const nodesById: Record<string, ExplorerNode> = {}
  for (const id of Object.keys(snapshot.nodesById)) {
    const node = snapshot.nodesById[id]
    if (!node) continue
    for (const explorerNode of convertToExplorerNodes(node)) {
      nodesById[explorerNode.id] = explorerNode
    }
  }

  const rootIds = snapshot.rootIds
    .map((id) => nodesById[id])
    .filter((node): node is ExplorerNode => Boolean(node) && node.origin.type === "node")
    .sort((left, right) => {
      const isLeftDefault = Boolean(left.isDefault)
      const isRightDefault = Boolean(right.isDefault)

      if (isLeftDefault !== isRightDefault) {
        return isLeftDefault ? -1 : 1
      }

      const byName = left.name.toLocaleLowerCase().localeCompare(right.name.toLocaleLowerCase())
      return byName
    })
    .map((node) => node.id)

  return {
    nodesById,
    rootIds,
    searchable: Object.values(nodesById).map((node) => ({ id: node.id, name: node.name })),
  }
}
