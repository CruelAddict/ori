import { type Node, type NodeEdge, NodeType } from "@adapters/ori/client"

export type ExplorerOrigin =
  | {
    type: "node"
    nodeId: string
    nodeType: Node["type"]
  }
  | {
    type: "edge"
    sourceNodeId: string
    edgeKey: string
  }
  | {
    type: "attribute"
    ownerNodeId: string
    attributeKey: string
    index?: number
  }

export type ExplorerNode = {
  id: string
  name: string
  icon?: string
  description?: string
  badges: string[]
  childIds: string[]
  hasChildren: boolean
  origin: ExplorerOrigin
  isDefault?: boolean
}

type ConstraintNode = Extract<Node, { type: typeof NodeType.CONSTRAINT }>
type IndexNode = Extract<Node, { type: typeof NodeType.INDEX }>
type TriggerNode = Extract<Node, { type: typeof NodeType.TRIGGER }>

function explorerNodeFromSnapshotNode(node: Node): ExplorerNode {
  const isDefault = "isDefault" in node.attributes ? Boolean(node.attributes.isDefault) : undefined
  return {
    id: node.id,
    origin: {
      type: "node",
      nodeId: node.id,
      nodeType: node.type,
    },
    isDefault,
    name: node.name,
    description: describeNode(node),
    badges: nodeBadges(node),
    childIds: [],
    hasChildren: false,
  }
}

export function createEdgeExplorerNode(node: Node, edgeName: string, edge: NodeEdge): ExplorerNode {
  const childIds = edge.items.slice()
  return {
    id: `edge:${node.id}:${edgeName}`,
    origin: {
      type: "edge",
      sourceNodeId: node.id,
      edgeKey: edgeName,
    },
    name: edgeName.replaceAll("_", " "),
    description: describeEdge(edge),
    badges: [],
    childIds,
    hasChildren: childIds.length > 0,
  }
}

// Explorer graph structure differs from that of the backend in following ways:
//   - graph edges become nodes, so between every two nodes appears a new "edge" node
//   - certain attributes like table columns become attached to the main node as a new synthetic edge
//     with values as its children nodes
//
// This function is responsible for doing these conversions
export function convertToExplorerNodes(node: Node): ExplorerNode[] {
  const nodes: ExplorerNode[] = []
  const self = explorerNodeFromSnapshotNode(node)
  nodes.push(self)

  const naturalEdgeNodes = Object.entries(node.edges)
    .filter(([, edge]) => edge.items.length > 0)
    .map(([name, edge]) => createEdgeExplorerNode(node, name, edge))

  const syntheticEdgeNodes = collectExpandableAttributes(node)
    .flatMap(([name, values]) => expandAttribute(node, name, values))

  const children = [...naturalEdgeNodes, ...syntheticEdgeNodes]
  children.forEach((n) => {
    if (n.origin.type === "edge" || (n.origin.type === "attribute" && n.origin.index === undefined)) {
      self.childIds.push(n.id)
      self.hasChildren = true
    }

    nodes.push(n)
  })

  return nodes
}

function expandAttribute(node: Node, attributeName: string, values: string[]): ExplorerNode[] {
  const items = values.map((value, index) => createAttributeExplorerNode(node, attributeName, value, index))

  return [
    ...items,
    createAttributeExplorerGroup(
      node,
      attributeName,
      items.map((item) => item.id),
    ),
  ]
}

// Returns node attributes that should be rendered as separate nodes/rows in explorer
function collectExpandableAttributes(node: Node): Array<[string, string[]]> {
  // [edge node name, [child node names]
  const attributes: Array<[string, string[]]> = []

  if (node.type === NodeType.INDEX) {
    attributes.push(
      ["columns", node.attributes.columns ?? []],
      ["include", node.attributes.includeColumns ?? []],
    )
  }

  if (node.type === NodeType.CONSTRAINT) {
    const contraintName = formatConstraintActionName(node.attributes)
    attributes.push(
      ["columns", node.attributes.columns ?? []],
      ["references", node.attributes.referencedColumns ?? []],
      ["action_rules", contraintName ? [contraintName] : []],
    )
  }

  if (node.type === NodeType.TRIGGER) {
    const ruleName = formatTriggerActionName(node.attributes)
    attributes.push(["action_rules", ruleName ? [ruleName] : []])
  }

  return attributes.filter(([, values]) => values.length > 0)
}

function createAttributeExplorerNode(node: Node, edgeName: string, value: string, index: number): ExplorerNode {
  return {
    id: `synthetic:${node.id}:${edgeName}:${index}`,
    origin: {
      type: "attribute",
      ownerNodeId: node.id,
      attributeKey: edgeName,
      index,
    },
    name: value,
    badges: [],
    childIds: [],
    hasChildren: false,
  }
}

function createAttributeExplorerGroup(node: Node, attributeName: string, childIds: string[]): ExplorerNode {
  return {
    id: `edge:${node.id}:${attributeName}`,
    origin: {
      type: "attribute",
      ownerNodeId: node.id,
      attributeKey: attributeName,
    },
    name: attributeName.replaceAll("_", " "),
    description: describeEdge({ items: childIds, truncated: false }),
    badges: [],
    childIds,
    hasChildren: childIds.length > 0,
  }
}

function formatConstraintActionName(attrs: ConstraintNode["attributes"]): string | undefined {
  const parts: string[] = []
  const match = attrs.match ?? ""
  const onUpdate = attrs.onUpdate ?? ""
  const onDelete = attrs.onDelete ?? ""
  if (match) parts.push(`match ${match.toLowerCase()}`)
  if (onUpdate) parts.push(`on update ${onUpdate.toLowerCase()}`)
  if (onDelete) parts.push(`on delete ${onDelete.toLowerCase()}`)
  if (parts.length === 0) return undefined
  return parts.join(", ")
}

function formatTriggerActionName(attrs: TriggerNode["attributes"]): string | undefined {
  const parts: string[] = []
  const timing = attrs.timing ?? ""
  const events = (attrs.events ?? []).filter((event: string) => event.length > 0)
  const eventsText = events.map((event: string) => event.toLowerCase()).join(" or ")
  const orientation = attrs.orientation ?? ""
  const condition = attrs.condition ?? ""
  const statement = attrs.statement ?? ""
  if (timing && eventsText) parts.push(`${timing.toLowerCase()} ${eventsText}`)
  if (!timing && eventsText) parts.push(eventsText)
  if (timing && !eventsText) parts.push(timing.toLowerCase())
  if (orientation) parts.push(`for each ${orientation.toLowerCase()}`)
  if (condition) parts.push(`when ${condition.toLowerCase()}`)
  if (statement) parts.push(statement.toLowerCase())
  if (parts.length === 0) return undefined
  return parts.join(", ")
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
      return undefined
  }
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

function constraintBadges(attrs: ConstraintNode["attributes"]): string[] {
  const constraintType = attrs.constraintType ?? ""
  if (constraintType === "PRIMARY KEY") {
    return ["primary"]
  }
  if (constraintType === "UNIQUE") {
    return ["unique"]
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
  return undefined
}

function describeIndex(attrs: IndexNode["attributes"]): string | undefined {
  const predicate = attrs.predicate ?? ""
  if (predicate) {
    return `where ${predicate.toLowerCase()}`
  }
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
