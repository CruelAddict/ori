import type { Node, NodeEdge } from "@shared/lib/configurations-client"

export type TreePaneNode = SnapshotTreePaneNode | EdgeTreePaneNode

type BaseTreePaneNode = {
  id: string
  kind: "node" | "edge"
  label: string
  icon?: string
  description?: string
  badges: string[]
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

type NormalizedNode =
  | { kind: "database" }
  | { kind: "tableView"; name: string; table?: string }
  | { kind: "column"; dataType?: string; primaryKeyPosition?: number; notNull?: boolean }
  | {
    kind: "constraint"
    constraintType?: string
    checkClause?: string
    referencedSchema?: string
    referencedTable?: string
    indexName?: string
    match?: string
    onUpdate?: string
    onDelete?: string
  }
  | { kind: "index"; predicate?: string; primary?: boolean; unique?: boolean }
  | { kind: "trigger"; timing?: string; events: string[]; enabledState?: string }
  | { kind: "other" }

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
  const normalized = normalizeNode(node)
  return {
    id: node.id,
    kind: "node",
    node,
    label: node.name,
    description: describeNode(normalized),
    badges: nodeBadges(normalized),
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
    badges: [],
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
  const baseCount = count > 0 ? (edge.truncated ? `${count}+` : String(count)) : "+"
  if (edge.truncated) {
    return `${baseCount} (truncated)`
  }
  return baseCount
}

function describeNode(node: NormalizedNode): string | undefined {
  switch (node.kind) {
    case "database":
      return "database"
    case "tableView": {
      const table = node.table ?? ""
      if (!table) {
        return undefined
      }
      if (table.trim().toLowerCase() === node.name.trim().toLowerCase()) {
        return undefined
      }
      return table
    }
    case "column":
      return node.dataType?.toLowerCase()
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

function nodeBadges(node: NormalizedNode): string[] {
  if (node.kind === "column") {
    const badges: string[] = []
    if ((node.primaryKeyPosition ?? 0) > 0) {
      badges.push("PK")
    }
    if (node.notNull) {
      badges.push("NOT NULL")
    }
    return badges
  }
  if (node.kind === "constraint") {
    return constraintBadges(node)
  }
  if (node.kind === "index") {
    return indexBadges(node)
  }
  if (node.kind === "trigger") {
    const state = node.enabledState ?? ""
    if (!state) return []
    return [state.toUpperCase()]
  }
  return []
}

function describeConstraint(node: Extract<NormalizedNode, { kind: "constraint" }>): string | undefined {
  const constraintType = node.constraintType ?? ""
  if (!constraintType) return undefined
  if (constraintType === "CHECK") {
    return node.checkClause
  }
  if (constraintType === "FOREIGN KEY") {
    const refSchema = node.referencedSchema ?? ""
    const refTable = node.referencedTable ?? ""
    const reference = [refSchema, refTable].filter(Boolean).join(".")
    if (reference) {
      return `foreigh key: ${reference}`
    }
  }
  if (constraintType === "UNIQUE") {
    const indexName = node.indexName ?? ""
    if (indexName) {
      return `unique (index ${indexName})`
    }
  }
  return constraintType.toLowerCase()
}

function constraintBadges(node: Extract<NormalizedNode, { kind: "constraint" }>): string[] {
  const constraintType = node.constraintType ?? ""
  if (constraintType !== "FOREIGN KEY") return []
  const badges: string[] = []
  const match = node.match ?? ""
  const onUpdate = node.onUpdate ?? ""
  const onDelete = node.onDelete ?? ""
  if (match) badges.push(`match ${match}`)
  if (onUpdate) badges.push(`on update ${onUpdate}`)
  if (onDelete) badges.push(`on delete ${onDelete}`)
  return badges
}

function describeIndex(node: Extract<NormalizedNode, { kind: "index" }>): string | undefined {
  const predicate = node.predicate ?? ""
  if (predicate) {
    return `where ${predicate}`
  }
  return node.unique ? "unique" : "index"
}

function describeTrigger(node: Extract<NormalizedNode, { kind: "trigger" }>): string | undefined {
  const timing = node.timing ?? ""
  const events = node.events.filter((event) => event.length > 0)
  const eventsLabel = events.join(" or ")
  if (timing && eventsLabel) {
    return `${timing} ${eventsLabel}`
  }
  return timing || eventsLabel || undefined
}

function indexBadges(node: Extract<NormalizedNode, { kind: "index" }>): string[] {
  const badges: string[] = []
  if (node.primary) { badges.push("primary") }
  if (node.unique) { badges.push("unique") }
  return badges
}

function normalizeNode(node: Node): NormalizedNode {
  const attrs = node.attributes

  const str = (key: string): string | undefined => {
    const value = attrs[key]
    if (typeof value === "string") {
      return value
    }
    return undefined
  }

  const num = (key: string): number | undefined => {
    const value = attrs[key]
    if (typeof value === "number") {
      return value
    }
    return undefined
  }

  const bool = (key: string): boolean | undefined => {
    const value = attrs[key]
    if (typeof value === "boolean") {
      return value
    }
    return undefined
  }

  const strArray = (key: string): string[] => {
    const value = attrs[key]
    if (!Array.isArray(value)) {
      return []
    }
    return value.filter((item): item is string => typeof item === "string")
  }

  if (node.type === "database") {
    return { kind: "database" }
  }

  if (node.type === "table" || node.type === "view") {
    return {
      kind: "tableView",
      name: node.name,
      table: str("table"),
    }
  }

  if (node.type === "column") {
    return {
      kind: "column",
      dataType: str("dataType"),
      primaryKeyPosition: num("primaryKeyPosition"),
      notNull: bool("notNull"),
    }
  }

  if (node.type === "constraint") {
    return {
      kind: "constraint",
      constraintType: str("constraintType"),
      checkClause: str("checkClause"),
      referencedSchema: str("referencedSchema"),
      referencedTable: str("referencedTable"),
      indexName: str("indexName"),
      match: str("match"),
      onUpdate: str("onUpdate"),
      onDelete: str("onDelete"),
    }
  }

  if (node.type === "index") {
    return {
      kind: "index",
      predicate: str("predicate"),
      primary: bool("primary"),
      unique: bool("unique"),
    }
  }

  if (node.type === "trigger") {
    return {
      kind: "trigger",
      timing: str("timing"),
      events: strArray("events"),
      enabledState: str("enabledState"),
    }
  }

  return { kind: "other" }
}
