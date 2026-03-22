import { type Node, type NodeEdge, NodeType } from "@adapters/ori/client"
import {
  createEdgeExplorerNode,
  createSnapshotExplorerNode,
  type ExplorerNode as ExplorerNodeState,
} from "../model/explorer-node"

type ConstraintNode = Extract<Node, { type: typeof NodeType.CONSTRAINT }>
type TriggerNode = Extract<Node, { type: typeof NodeType.TRIGGER }>

export type ExplorerGraph = {
  nodesById: Record<string, ExplorerNodeState>
  rootIds: string[]
  searchable: Array<{ id: string; name: string }>
}

export function createExplorerGraph(snapshot: { nodesById: Record<string, Node>; rootIds: string[] }): ExplorerGraph {
  const nodesById: Record<string, ExplorerNodeState> = {}
  for (const id of Object.keys(snapshot.nodesById)) {
    const node = snapshot.nodesById[id]
    if (!node) continue
    for (const explorerNode of convertSnapshotNodeEntities(node)) {
      nodesById[explorerNode.id] = explorerNode
    }
  }

  return {
    nodesById,
    rootIds: sortRootIds(snapshot.rootIds, nodesById),
    searchable: Object.values(nodesById).map((node) => ({ id: node.id, name: node.label })),
  }
}

export function convertSnapshotNodeEntities(node: Node): ExplorerNodeState[] {
  const explorerNodes: ExplorerNodeState[] = []
  const explorerNode = createSnapshotExplorerNode(node)
  explorerNodes.push(explorerNode)

  const attachEdge = (edge: ReturnType<typeof createEdgeExplorerNode>) => {
    explorerNode.childIds.push(edge.id)
    explorerNode.hasChildren = explorerNode.childIds.length > 0
    explorerNodes.push(edge)
  }

  const attachSyntheticEdge = (name: string, labels: string[]) => {
    if (labels.length === 0) return
    const childIds: string[] = []
    for (let index = 0; index < labels.length; index += 1) {
      const label = labels[index]
      const childId = `synthetic:${node.id}:${name}:${index}`
      const child: Node = {
        id: childId,
        type: NodeType.COLUMN,
        name: label,
        attributes: {
          resource: "synthetic",
          table: node.name,
          column: label,
          ordinal: index,
          dataType: "",
          notNull: false,
        },
        edges: {},
      }
      const childExplorerNode = createSnapshotExplorerNode(child)
      explorerNodes.push(childExplorerNode)
      childIds.push(childExplorerNode.id)
    }
    if (childIds.length === 0) return
    attachEdge(
      createEdgeExplorerNode(node, name, {
        items: childIds,
        truncated: false,
      }),
    )
  }

  if (node.type === NodeType.INDEX) {
    attachSyntheticEdge("columns", node.attributes.columns ?? [])
    attachSyntheticEdge("include", node.attributes.includeColumns ?? [])
  }

  if (node.type === NodeType.CONSTRAINT) {
    attachSyntheticEdge("columns", node.attributes.columns ?? [])
    attachSyntheticEdge("references", node.attributes.referencedColumns ?? [])
    const label = formatConstraintActionLabel(node.attributes)
    if (label) {
      attachSyntheticEdge("action_rules", [label])
    }
  }

  if (node.type === NodeType.TRIGGER) {
    const label = formatTriggerActionLabel(node.attributes)
    if (label) {
      attachSyntheticEdge("action_rules", [label])
    }
  }

  for (const [name, edge] of Object.entries(node.edges) as Array<[string, NodeEdge]>) {
    if (!edge.items || edge.items.length === 0) continue
    attachEdge(createEdgeExplorerNode(node, name, edge))
  }

  return explorerNodes
}

function formatConstraintActionLabel(attrs: ConstraintNode["attributes"]): string | undefined {
  const labels: string[] = []
  const match = attrs.match ?? ""
  const onUpdate = attrs.onUpdate ?? ""
  const onDelete = attrs.onDelete ?? ""
  if (match) labels.push(`match ${match.toLowerCase()}`)
  if (onUpdate) labels.push(`on update ${onUpdate.toLowerCase()}`)
  if (onDelete) labels.push(`on delete ${onDelete.toLowerCase()}`)
  if (labels.length === 0) return undefined
  return labels.join(", ")
}

function formatTriggerActionLabel(attrs: TriggerNode["attributes"]): string | undefined {
  const labels: string[] = []
  const timing = attrs.timing ?? ""
  const events = (attrs.events ?? []).filter((event: string) => event.length > 0)
  const eventsLabel = events.map((event: string) => event.toLowerCase()).join(" or ")
  const orientation = attrs.orientation ?? ""
  const condition = attrs.condition ?? ""
  const statement = attrs.statement ?? ""
  if (timing && eventsLabel) labels.push(`${timing.toLowerCase()} ${eventsLabel}`)
  if (!timing && eventsLabel) labels.push(eventsLabel)
  if (timing && !eventsLabel) labels.push(timing.toLowerCase())
  if (orientation) labels.push(`for each ${orientation.toLowerCase()}`)
  if (condition) labels.push(`when ${condition.toLowerCase()}`)
  if (statement) labels.push(statement.toLowerCase())
  if (labels.length === 0) return undefined
  return labels.join(", ")
}

function sortRootIds(rootIds: string[], nodesById: Record<string, ExplorerNodeState>) {
  const nodes = rootIds.map((id) => nodesById[id]).filter((node): node is ExplorerNodeState => Boolean(node))
  nodes.sort((left, right) => {
    const leftNode = getSnapshotNode(left)
    const rightNode = getSnapshotNode(right)
    const leftDefault = isDefaultRoot(leftNode)
    const rightDefault = isDefaultRoot(rightNode)

    if (leftDefault !== rightDefault) {
      return leftDefault ? -1 : 1
    }

    const byName = (leftNode?.name ?? "").toLocaleLowerCase().localeCompare((rightNode?.name ?? "").toLocaleLowerCase())
    if (byName !== 0) {
      return byName
    }

    return left.id.localeCompare(right.id)
  })
  return nodes.map((node) => node.id)
}

function getSnapshotNode(node: ExplorerNodeState | undefined) {
  if (!node) return undefined
  if (node.kind !== "node") return undefined
  return node.node
}

function isDefaultRoot(node?: Node): boolean {
  if (!node) return false
  if (node.type !== NodeType.DATABASE && node.type !== NodeType.SCHEMA) return false
  return node.attributes.isDefault
}
