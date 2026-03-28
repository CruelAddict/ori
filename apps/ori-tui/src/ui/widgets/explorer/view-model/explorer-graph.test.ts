import { describe, expect, test } from "bun:test"
import { type Node, type NodeEdge, NodeType } from "@adapters/ori/client"
import { createExplorerGraph } from "./explorer-graph"
import type { ExplorerNode } from "./explorer-node"
import { convertToExplorerNodes } from "./explorer-node"

type NodeOverrides = {
  id: string
  type?: Node["type"]
  name?: string
  attributes?: Record<string, unknown>
  edges?: Record<string, NodeEdge>
}

const makeNode = (overrides: NodeOverrides): Node => {
  const kind = overrides.type ?? NodeType.TABLE
  const name = overrides.name ?? overrides.id

  if (kind === NodeType.DATABASE) {
    return {
      id: overrides.id,
      type: kind,
      name,
      attributes: Object.assign({ resource: "test", engine: "sqlite" }, overrides.attributes ?? {}),
      edges: overrides.edges ?? {},
    } as Node
  }

  if (kind === NodeType.COLUMN) {
    return {
      id: overrides.id,
      type: kind,
      name,
      attributes: {
        ...Object.assign(
          {
            resource: "test",
            table: "users",
            column: name,
            ordinal: 1,
            dataType: "text",
            notNull: false,
          },
          overrides.attributes ?? {},
        ),
      },
      edges: overrides.edges ?? {},
    } as Node
  }

  if (kind === NodeType.CONSTRAINT) {
    return {
      id: overrides.id,
      type: kind,
      name,
      attributes: {
        ...Object.assign(
          {
            resource: "test",
            table: "users",
            constraintName: name,
            constraintType: "FOREIGN KEY",
          },
          overrides.attributes ?? {},
        ),
      },
      edges: overrides.edges ?? {},
    } as Node
  }

  if (kind === NodeType.INDEX) {
    return {
      id: overrides.id,
      type: kind,
      name,
      attributes: {
        ...Object.assign(
          {
            resource: "test",
            table: "users",
            indexName: name,
            unique: false,
            primary: false,
          },
          overrides.attributes ?? {},
        ),
      },
      edges: overrides.edges ?? {},
    } as Node
  }

  if (kind === NodeType.TRIGGER) {
    return {
      id: overrides.id,
      type: kind,
      name,
      attributes: {
        ...Object.assign(
          {
            resource: "test",
            table: "users",
            triggerName: name,
            timing: "BEFORE",
            orientation: "ROW",
          },
          overrides.attributes ?? {},
        ),
      },
      edges: overrides.edges ?? {},
    } as Node
  }

  if (kind === NodeType.VIEW) {
    return {
      id: overrides.id,
      type: kind,
      name,
      attributes: Object.assign({ resource: "test", table: name, tableType: "view" }, overrides.attributes ?? {}),
      edges: overrides.edges ?? {},
    } as Node
  }

  return {
    id: overrides.id,
    type: kind,
    name,
    attributes: Object.assign({ resource: "test", table: name, tableType: "table" }, overrides.attributes ?? {}),
    edges: overrides.edges ?? {},
  } as Node
}

const makeEdge = (items: string[], truncated = false): NodeEdge => ({
  items,
  truncated,
})

const edgeId = (nodeId: string, edgeName: string) => `edge:${nodeId}:${edgeName}`
const syntheticId = (nodeId: string, edgeName: string, index: number) => `synthetic:${nodeId}:${edgeName}:${index}`

const toExplorerNodeMap = (node: Node) => {
  const map: Record<string, ExplorerNode> = {}
  for (const child of convertToExplorerNodes(node)) {
    map[child.id] = child
  }
  return map
}

describe("expandExplorerNode", () => {
  test("creates edge explorer nodes for non-empty edges", () => {
    const db = makeNode({
      id: "db-1",
      type: NodeType.DATABASE,
      name: "main",
      edges: { tables: makeEdge(["table-1"]) },
    })
    const table = makeNode({ id: "table-1", type: NodeType.TABLE, name: "public.users" })

    const explorerNodes = toExplorerNodeMap(db)

    const dbExplorerNode = explorerNodes[db.id]
    expect(dbExplorerNode?.origin).toEqual({
      type: "node",
      nodeId: db.id,
      nodeType: NodeType.DATABASE,
    })
    expect(dbExplorerNode?.childIds).toEqual([edgeId(db.id, "tables")])

    const tablesEdge = explorerNodes[edgeId(db.id, "tables")]
    expect(tablesEdge?.origin).toEqual({
      type: "edge",
      sourceNodeId: db.id,
      edgeKey: "tables",
    })
    expect(tablesEdge?.childIds).toEqual([table.id])
    expect(tablesEdge?.hasChildren).toBe(true)
  })

  test("skips empty edges", () => {
    const db = makeNode({
      id: "db-1",
      type: NodeType.DATABASE,
      name: "main",
      edges: { tables: makeEdge([]), views: makeEdge([], true) },
    })

    const explorerNodes = toExplorerNodeMap(db)

    const dbExplorerNode = explorerNodes[db.id]
    expect(dbExplorerNode?.childIds).toEqual([])
    expect(explorerNodes[edgeId(db.id, "tables")]).toBeUndefined()
    expect(explorerNodes[edgeId(db.id, "views")]).toBeUndefined()
  })

  test("creates synthetic edges for index columns and includeColumns", () => {
    const index = makeNode({
      id: "idx-1",
      type: NodeType.INDEX,
      name: "users_idx",
      attributes: { columns: ["id", "email"], includeColumns: ["created_at"] },
    })

    const explorerNodes = toExplorerNodeMap(index)

    const indexExplorerNode = explorerNodes[index.id]
    expect(indexExplorerNode?.childIds).toEqual([edgeId(index.id, "columns"), edgeId(index.id, "include")])

    const columnsEdge = explorerNodes[edgeId(index.id, "columns")]
    const includeEdge = explorerNodes[edgeId(index.id, "include")]
    expect(columnsEdge?.origin).toEqual({ type: "attribute", ownerNodeId: index.id, attributeKey: "columns" })
    expect(includeEdge?.origin).toEqual({ type: "attribute", ownerNodeId: index.id, attributeKey: "include" })
    expect(columnsEdge?.childIds).toEqual([syntheticId(index.id, "columns", 0), syntheticId(index.id, "columns", 1)])
    expect(includeEdge?.childIds).toEqual([syntheticId(index.id, "include", 0)])

    const firstColumn = explorerNodes[syntheticId(index.id, "columns", 0)]
    const secondColumn = explorerNodes[syntheticId(index.id, "columns", 1)]
    const includeColumn = explorerNodes[syntheticId(index.id, "include", 0)]
    expect(firstColumn?.origin).toEqual({ type: "attribute", ownerNodeId: index.id, attributeKey: "columns", index: 0 })
    expect(firstColumn?.name).toBe("id")
    expect(secondColumn?.name).toBe("email")
    expect(includeColumn?.name).toBe("created_at")
  })

  test("creates synthetic edges for constraint columns, references, and action rules", () => {
    const constraint = makeNode({
      id: "fk-1",
      type: NodeType.CONSTRAINT,
      name: "orders_user_id_fkey",
      attributes: {
        columns: ["user_id"],
        referencedColumns: ["users.id"],
        match: "FULL",
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      },
    })

    const explorerNodes = toExplorerNodeMap(constraint)

    const constraintExplorerNode = explorerNodes[constraint.id]
    expect(constraintExplorerNode?.childIds).toEqual([
      edgeId(constraint.id, "columns"),
      edgeId(constraint.id, "references"),
      edgeId(constraint.id, "action_rules"),
    ])

    const columnsEdge = explorerNodes[edgeId(constraint.id, "columns")]
    const referencesEdge = explorerNodes[edgeId(constraint.id, "references")]
    const rulesEdge = explorerNodes[edgeId(constraint.id, "action_rules")]
    expect(columnsEdge?.childIds).toEqual([syntheticId(constraint.id, "columns", 0)])
    expect(referencesEdge?.childIds).toEqual([syntheticId(constraint.id, "references", 0)])
    expect(rulesEdge?.childIds).toEqual([syntheticId(constraint.id, "action_rules", 0)])
    const actionRule = explorerNodes[syntheticId(constraint.id, "action_rules", 0)]
    expect(actionRule?.name).toBe("match full, on update cascade, on delete restrict")
  })

  test("creates synthetic action rules edge for triggers", () => {
    const trigger = makeNode({
      id: "trg-1",
      type: NodeType.TRIGGER,
      name: "users_audit",
      attributes: {
        timing: "BEFORE",
        events: ["INSERT", "UPDATE"],
        orientation: "ROW",
        condition: "NEW.active = TRUE",
      },
    })

    const explorerNodes = toExplorerNodeMap(trigger)

    const triggerExplorerNode = explorerNodes[trigger.id]
    expect(triggerExplorerNode?.childIds).toEqual([edgeId(trigger.id, "action_rules")])

    const rulesEdge = explorerNodes[edgeId(trigger.id, "action_rules")]
    expect(rulesEdge?.childIds).toEqual([syntheticId(trigger.id, "action_rules", 0)])
    const actionRule = explorerNodes[syntheticId(trigger.id, "action_rules", 0)]
    expect(actionRule?.name).toBe("before insert or update, for each row, when new.active = true")
  })

  test("skips synthetic edges when arrays are empty", () => {
    const index = makeNode({
      id: "idx-1",
      type: NodeType.INDEX,
      name: "users_idx",
      attributes: { columns: [] },
    })

    const explorerNodes = toExplorerNodeMap(index)

    const indexExplorerNode = explorerNodes[index.id]
    expect(indexExplorerNode?.childIds).toEqual([])
    expect(explorerNodes[edgeId(index.id, "columns")]).toBeUndefined()
  })

  test("sorts root snapshot nodes by isDefault and name", () => {
    const alpha = makeNode({
      id: "db-1",
      type: NodeType.DATABASE,
      name: "alpha",
      attributes: { isDefault: false },
    })
    const main = makeNode({
      id: "db-2",
      type: NodeType.DATABASE,
      name: "main",
      attributes: { isDefault: true },
    })
    const zoo = makeNode({
      id: "db-3",
      type: NodeType.DATABASE,
      name: "zoo",
      attributes: { isDefault: false },
    })

    const graph = createExplorerGraph({
      nodesById: {
        [alpha.id]: alpha,
        [main.id]: main,
        [zoo.id]: zoo,
      },
      rootIds: [zoo.id, alpha.id, main.id],
    })

    expect(graph.rootIds).toEqual([main.id, alpha.id, zoo.id])
  })
})
