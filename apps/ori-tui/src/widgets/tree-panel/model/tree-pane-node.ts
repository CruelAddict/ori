import type { Node, NodeEdge } from "@shared/lib/configurations-client"

export type TreePaneNode = SnapshotTreePaneNode | EdgeTreePaneNode

type BaseTreePaneNode = {
  id: string
  kind: "node" | "edge"
  label: string
  icon?: string
  description?: string
  badges?: string[]
  childIds: string[]
  hasChildren: boolean
}

// SnapshotTreePaneNode represents a node that represents an actual node
// from a snapshot that we retrieved from backend
export interface SnapshotTreePaneNode extends BaseTreePaneNode {
  kind: "node"
  node: Node
}

// EdgeTreePaneNode represents a node that doesn't exist in the snapshot
// and that we introduced for display purposes
export interface EdgeTreePaneNode extends BaseTreePaneNode {
  kind: "edge"
  sourceNodeId: string
  edgeName: string
  truncated: boolean
}

export function buildTreePaneNodeMap(nodes: Map<string, Node>): Map<string, TreePaneNode> {
  const map = new Map<string, TreePaneNode>()

  for (const node of nodes.values()) {
    map.set(node.id, createSnapshotTreePaneNode(node))
  }

  for (const node of nodes.values()) {
    const parent = map.get(node.id)
    if (!parent || parent.kind !== "node") {
      continue
    }
    for (const [edgeName, edge] of Object.entries(node.edges ?? {})) {
      if (!edge.items || edge.items.length === 0) {
        continue
      }
      const edgeEntity = createEdgeTreePaneNode(node, edgeName, edge)
      map.set(edgeEntity.id, edgeEntity)
      parent.childIds.push(edgeEntity.id)
      parent.hasChildren = parent.childIds.length > 0
    }
  }

  return map
}

export function createSnapshotTreePaneNode(node: Node): SnapshotTreePaneNode {
  return {
    id: node.id,
    kind: "node",
    node,
    label: node.name,
    description: describeNode(node),
    badges: nodeBadges(node),
    childIds: [],
    hasChildren: false,
  }
}

export function createEdgeTreePaneNode(node: Node, edgeName: string, edge: NodeEdge): EdgeTreePaneNode {
  const childIds = edge.items.slice()
  return {
    id: edgeEntityId(node.id, edgeName),
    kind: "edge",
    sourceNodeId: node.id,
    edgeName,
    label: edgeLabel(edgeName),
    description: describeEdge(edge),
    childIds,
    hasChildren: childIds.length > 0,
    truncated: edge.truncated,
  }
}

function edgeEntityId(nodeId: string, edgeName: string): string {
  return `edge:${nodeId}:${edgeName}`
}

function edgeLabel(edgeName: string): string {
  return edgeName
}

function describeEdge(edge: NodeEdge): string | undefined {
  const count = edge.items.length
  if (count === 0 && !edge.truncated) {
    return undefined
  }
  const suffix = count === 1 ? "item" : "items"
  const baseCount = formatEdgeCount(count, edge.truncated)
  return `${baseCount} ${suffix} ${edge.truncated ? "(truncated)" : ""}`.trim()
}

function formatEdgeCount(count: number, truncated: boolean): string {
  if (count > 0) {
    return truncated ? `${count}+` : String(count)
  }
  if (truncated) {
    return "+"
  }
  return "0"
}

function describeNode(node: Node): string | undefined {
  switch (node.type) {
    case "database":
      return "database"
    case "table":
    case "view":
      return typeof node.attributes?.table === "string" ? node.attributes.table : undefined
    case "column":
      return typeof node.attributes?.dataType === "string" ? node.attributes.dataType : undefined
    case "constraint":
      return describeConstraint(node)
    case "index":
      return describeIndex(node)
    case "trigger":
      return describeTrigger(node)
    default:
      return undefined
  }
}

function nodeBadges(node: Node): string[] | undefined {
  if (node.type === "column") {
    const badges: string[] = []
    const position = typeof node.attributes?.primaryKeyPosition === "number" ? node.attributes.primaryKeyPosition : 0
    if (position > 0) {
      badges.push("PK")
    }
    if (node.attributes?.notNull) {
      badges.push("NOT NULL")
    }
    return badges.length > 0 ? badges : undefined
  }
  if (node.type === "constraint") {
    return constraintBadges(node)
  }
  if (node.type === "index") {
    return indexBadges(node)
  }
  if (node.type === "trigger") {
    const state = typeof node.attributes?.enabledState === "string" ? node.attributes.enabledState : ""
    if (!state) return undefined
    return [state.toUpperCase()]
  }
  return undefined
}

function describeConstraint(node: Node): string | undefined {
  const constraintType = typeof node.attributes?.constraintType === "string" ? node.attributes.constraintType : ""
  if (!constraintType) return undefined
  if (constraintType === "CHECK") {
    return typeof node.attributes?.checkClause === "string" ? node.attributes.checkClause : constraintType
  }
  if (constraintType === "FOREIGN KEY") {
    const refSchema = typeof node.attributes?.referencedSchema === "string" ? node.attributes.referencedSchema : ""
    const refTable = typeof node.attributes?.referencedTable === "string" ? node.attributes.referencedTable : ""
    const reference = [refSchema, refTable].filter(Boolean).join(".")
    if (reference) {
      return `FOREIGN KEY -> ${reference}`
    }
  }
  if (constraintType === "UNIQUE") {
    const indexName = typeof node.attributes?.indexName === "string" ? node.attributes.indexName : ""
    if (indexName) {
      return `UNIQUE (index ${indexName})`
    }
  }
  return constraintType
}

function constraintBadges(node: Node): string[] | undefined {
  const constraintType = typeof node.attributes?.constraintType === "string" ? node.attributes.constraintType : ""
  if (constraintType !== "FOREIGN KEY") return undefined
  const badges: string[] = []
  const match = typeof node.attributes?.match === "string" ? node.attributes.match : ""
  const onUpdate = typeof node.attributes?.onUpdate === "string" ? node.attributes.onUpdate : ""
  const onDelete = typeof node.attributes?.onDelete === "string" ? node.attributes.onDelete : ""
  if (match) badges.push(`MATCH ${match}`)
  if (onUpdate) badges.push(`ON UPDATE ${onUpdate}`)
  if (onDelete) badges.push(`ON DELETE ${onDelete}`)
  return badges.length > 0 ? badges : undefined
}

function describeIndex(node: Node): string | undefined {
  const predicate = typeof node.attributes?.predicate === "string" ? node.attributes.predicate : ""
  if (predicate) {
    return `where ${predicate}`
  }
  return node.attributes?.unique === true ? "unique" : "index"
}

function describeTrigger(node: Node): string | undefined {
  const timing = typeof node.attributes?.timing === "string" ? node.attributes.timing : ""
  const rawEvents = node.attributes?.events
  const events = Array.isArray(rawEvents)
    ? rawEvents.filter((event): event is string => typeof event === "string" && event.length > 0)
    : []
  const eventsLabel = events.join(" OR ")
  if (timing && eventsLabel) {
    return `${timing} ${eventsLabel}`
  }
  if (timing) {
    return timing
  }
  if (eventsLabel) {
    return eventsLabel
  }
  return undefined
}

function indexBadges(node: Node): string[] | undefined {
  const badges: string[] = []
  if (node.attributes?.primary === true) {
    badges.push("PRIMARY")
  }
  if (node.attributes?.unique === true) {
    badges.push("UNIQUE")
  }
  return badges.length > 0 ? badges : undefined
}
