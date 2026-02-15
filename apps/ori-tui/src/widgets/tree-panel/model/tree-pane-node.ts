import { type Node, type NodeEdge, NodeType } from "@shared/lib/configurations-client"

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

type ConstraintNode = Extract<Node, { type: typeof NodeType.CONSTRAINT }>
type IndexNode = Extract<Node, { type: typeof NodeType.INDEX }>
type TriggerNode = Extract<Node, { type: typeof NodeType.TRIGGER }>

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
    const entries = Object.entries(node.edges) as Array<[string, NodeEdge]>
    for (const [edgeName, edge] of entries) {
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
  return edgeName.replaceAll("_", " ")
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

function describeNode(node: Node): string | undefined {
  switch (node.type) {
    case NodeType.DATABASE:
      return "database"
    case NodeType.SCHEMA:
      return "schema"
    case NodeType.TABLE: {
      const table = node.attributes.table ?? ""
      if (!table) {
        return undefined
      }
      if (table.trim().toLowerCase() === node.name.trim().toLowerCase()) {
        return undefined
      }
      return table.toLowerCase()
    }
    case NodeType.VIEW: {
      const table = node.attributes.table ?? ""
      if (!table) {
        return undefined
      }
      if (table.trim().toLowerCase() === node.name.trim().toLowerCase()) {
        return undefined
      }
      return table.toLowerCase()
    }
    case NodeType.COLUMN:
      return node.attributes.dataType?.toLowerCase()
    case NodeType.CONSTRAINT:
      return describeConstraint(node.attributes)
    case NodeType.INDEX:
      return describeIndex(node.attributes)
    case NodeType.TRIGGER:
      return describeTrigger(node.attributes)
  }
  return undefined
}

function nodeBadges(node: Node): string[] {
  if (node.type === NodeType.COLUMN) {
    const badges: string[] = []
    if ((node.attributes.primaryKeyPosition ?? 0) > 0) {
      badges.push("pk")
    }
    if (node.attributes.notNull) {
      badges.push("!null")
    }
    return badges
  }
  if (node.type === NodeType.CONSTRAINT) {
    return constraintBadges(node.attributes)
  }
  if (node.type === NodeType.INDEX) {
    return indexBadges(node.attributes)
  }
  if (node.type === NodeType.TRIGGER) {
    const state = node.attributes.enabledState ?? ""
    if (!state) return []
    return [state.toLowerCase()]
  }
  return []
}

function describeConstraint(attrs: ConstraintNode["attributes"]): string | undefined {
  const constraintType = attrs.constraintType ?? ""
  if (!constraintType) return undefined
  if (constraintType === "CHECK") {
    const clause = attrs.checkClause ?? ""
    if (!clause) return "check"
    return clause.toLowerCase()
  }
  if (constraintType === "FOREIGN KEY") {
    const refSchema = attrs.referencedSchema ?? ""
    const refTable = attrs.referencedTable ?? ""
    const reference = [refSchema, refTable].filter(Boolean).join(".")
    if (reference) {
      return `references ${reference.toLowerCase()}`
    }
    return "foreign key"
  }
  if (constraintType === "UNIQUE") {
    const indexName = attrs.indexName ?? ""
    if (indexName) {
      return `index ${indexName.toLowerCase()}`
    }
    return ""
  }
  return constraintType.toLowerCase()
}

function constraintBadges(_attrs: ConstraintNode["attributes"]): string[] {
  return []
}

function describeIndex(attrs: IndexNode["attributes"]): string | undefined {
  const predicate = attrs.predicate ?? ""
  if (predicate) {
    return `where ${predicate.toLowerCase()}`
  }
  return "index"
}

function describeTrigger(_attrs: TriggerNode["attributes"]): string | undefined {
  return undefined
}

function indexBadges(attrs: IndexNode["attributes"]): string[] {
  const badges: string[] = []
  if (attrs.primary) {
    badges.push("primary")
  }
  if (attrs.unique) {
    badges.push("unique")
  }
  return badges
}
