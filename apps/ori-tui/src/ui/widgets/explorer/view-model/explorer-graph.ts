import type { Node } from "@adapters/ori/client"
import { convertToExplorerNodes, type ExplorerNode, type SnapshotExplorerNode } from "./explorer-node"

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
    .filter((node): node is SnapshotExplorerNode => Boolean(node) && node.kind === "node")
    .sort((left, right) => {
      const isLeftDefault = "isDefault" in left.node.attributes && Boolean(left.node.attributes.isDefault)
      const isRightDefault = "isDefault" in right.node.attributes && Boolean(right.node.attributes.isDefault)

      if (isLeftDefault !== isRightDefault) {
        return isLeftDefault ? -1 : 1
      }

      const byName = left.node.name.toLocaleLowerCase().localeCompare(right.node.name.toLocaleLowerCase())
      return byName
    })
    .map((node) => node.id)

  return {
    nodesById,
    rootIds,
    searchable: Object.values(nodesById).map((node) => ({ id: node.id, name: node.label })),
  }
}
