import { type Node, type NodeEdge, NodeType } from "@adapters/ori/client"

export type ExplorerNode = SnapshotExplorerNode | EdgeExplorerNode

type BaseExplorerNode = {
  id: string
  kind: "node" | "edge"
  label: string
  icon?: string
  description?: string
  badges: string[]
  childIds: string[]
  hasChildren: boolean
}

export interface SnapshotExplorerNode extends BaseExplorerNode {
  kind: "node"
  node: Node
}

export interface EdgeExplorerNode extends BaseExplorerNode {
  kind: "edge"
  sourceNodeId: string
  edgeName: string
  truncated: boolean
}

type ConstraintNode = Extract<Node, { type: typeof NodeType.CONSTRAINT }>
type IndexNode = Extract<Node, { type: typeof NodeType.INDEX }>
type TriggerNode = Extract<Node, { type: typeof NodeType.TRIGGER }>

function createSnapshotExplorerNode(node: Node): SnapshotExplorerNode {
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

export function createEdgeExplorerNode(node: Node, edgeName: string, edge: NodeEdge): EdgeExplorerNode {
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

// Explorer graph structure differs from that of the backend in following ways:
//   - graph edges become nodes, so between every two nodes appears a new "edge" node
//   - certain attributes like table columns become attached to the main node as a new synthetic edge
//     with values as its children nodes
//
// This function is responsible for doing these conversions
export function convertToExplorerNodes(node: Node): ExplorerNode[] {
  const nodes: ExplorerNode[] = []
  const self = createSnapshotExplorerNode(node)
  nodes.push(self)

  const edgeNodes = [
    // synthetic edge nodes
    ...collectExpandableAttributes(node)
      .flatMap(([name, values]) => expandAttribute(node, name, values)),
    // natural edge nodes
    ...Object.entries(node.edges)
      .filter(([, edge]) => edge.items.length > 0)
      .map(([name, edge]) => createEdgeExplorerNode(node, name, edge))
  ]

  edgeNodes.forEach((node) => {
    if (node.kind === "edge") {
      self.childIds.push(node.id)
      self.hasChildren = true
    }

    nodes.push(node)
  })

  return nodes
}

function expandAttribute(node: Node, attributeName: string, values: string[]): ExplorerNode[] {
  const items = values.map((value, index) => createAttributeExplorerNode(node, attributeName, value, index))

  return [
    ...items,
    createEdgeExplorerNode(node, attributeName, {
      items: items.map((item) => item.id),
      truncated: false,
    }),
  ]
}

// Returns node attributes that should be rendered as separate nodes/rows in explorer
function collectExpandableAttributes(node: Node): Array<[string, string[]]> {
  const attributes: Array<[string, string[]]> = []

  if (node.type === NodeType.INDEX) {
    attributes.push(
      ["columns", node.attributes.columns ?? []],
      ["include", node.attributes.includeColumns ?? []],
    )
  }

  if (node.type === NodeType.CONSTRAINT) {
    const value = formatConstraintActionLabel(node.attributes)
    attributes.push(
      ["columns", node.attributes.columns ?? []],
      ["references", node.attributes.referencedColumns ?? []],
      ["action_rules", value ? [value] : []],
    )
  }

  if (node.type === NodeType.TRIGGER) {
    const value = formatTriggerActionLabel(node.attributes)
    attributes.push(["action_rules", value ? [value] : []])
  }

  return attributes.filter(([, values]) => values.length > 0)
}

function createAttributeExplorerNode(node: Node, edgeName: string, value: string, index: number): SnapshotExplorerNode {
  return createSnapshotExplorerNode({
    id: syntheticEntityId(node.id, edgeName, index),
    type: NodeType.COLUMN,
    name: value,
    attributes: {
      resource: "synthetic",
      table: node.name,
      column: value,
      ordinal: index,
      dataType: "",
      notNull: false,
    },
    edges: {},
  })
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

function edgeEntityId(nodeId: string, edgeName: string): string {
  return `edge:${nodeId}:${edgeName}`
}

function syntheticEntityId(nodeId: string, edgeName: string, index: number): string {
  return `synthetic:${nodeId}:${edgeName}:${index}`
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
