import { type Node, NodeType } from "@adapters/ori/client"
import { type BrowsableExplorerNode, convertToExplorerNodes, type ExplorerNode } from "./explorer-node"

export type ExplorerGraph = {
  nodesById: Record<string, ExplorerNode>
  rootIds: string[]
  searchable: Array<{ id: string; name: string }>
  parentById: Record<string, string>
}

type BrowseSourceNode = Extract<Node, { type: typeof NodeType.TABLE | typeof NodeType.VIEW }>
type BrowseScopeNode = Extract<Node, { type: typeof NodeType.DATABASE | typeof NodeType.SCHEMA }>

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
  attachBrowseCapabilities(nodesById, snapshot.nodesById, parentById)

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

function attachBrowseCapabilities(
  nodesById: Record<string, ExplorerNode>,
  snapshotNodesById: Record<string, Node>,
  parentById: Record<string, string>,
) {
  for (const node of Object.values(snapshotNodesById)) {
    if (!isBrowseSourceNode(node)) continue

    const explorerNode = nodesById[node.id]
    if (!explorerNode) continue

    const scope = findBrowseScopeNode(node.id, nodesById, snapshotNodesById, parentById)
    if (!scope) continue

    const relation = node.attributes.table.trim() || node.name.trim()
    if (!relation) continue

    const qualified = [scope.name, relation].map(quoteIdent).join(".")
    const target = explorerNode as Partial<BrowsableExplorerNode>
    target.getQualifiedName = () => qualified
  }
}

function isBrowseSourceNode(node: Node): node is BrowseSourceNode {
  return node.type === NodeType.TABLE || node.type === NodeType.VIEW
}

function findBrowseScopeNode(
  nodeId: string,
  nodesById: Record<string, ExplorerNode>,
  snapshotNodesById: Record<string, Node>,
  parentById: Record<string, string>,
): BrowseScopeNode | null {
  let id = parentById[nodeId]
  while (id) {
    const explorerNode = nodesById[id]
    if (explorerNode?.origin.type === "node") {
      const node = snapshotNodesById[explorerNode.origin.nodeId]
      if (node?.type === NodeType.DATABASE || node?.type === NodeType.SCHEMA) return node
    }
    id = parentById[id]
  }
  return null
}

function quoteIdent(value: string) {
  return `"${value.replaceAll('"', '""')}"`
}
