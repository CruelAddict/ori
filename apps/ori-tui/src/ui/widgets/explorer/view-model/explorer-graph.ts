import type { Node } from "@adapters/ori/client"
import { convertToExplorerNodes, type ExplorerNode } from "./explorer-node"

export type ExplorerGraph = {
  nodesById: Record<string, ExplorerNode>
  rootIds: string[]
  searchable: Array<{ id: string; name: string }>
  parentById: Record<string, string>
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

  const parentById = buildParentById(nodesById, rootIds)

  return {
    nodesById,
    rootIds,
    searchable: Object.values(nodesById).map((node) => ({ id: node.id, name: node.name })),
    parentById,
  }
}

function buildParentById(nodesById: Record<string, ExplorerNode>, rootIds: string[]) {
  const parentById: Record<string, string> = {}
  const seen = new Set<string>()

  const visit = (id: string) => {
    if (seen.has(id)) return
    seen.add(id)

    const node = nodesById[id]
    if (!node) return

    for (const childId of node.childIds) {
      if (nodesById[childId] && parentById[childId] === undefined) {
        parentById[childId] = id
      }
      visit(childId)
    }
  }

  for (const id of rootIds) {
    visit(id)
  }

  return parentById
}
