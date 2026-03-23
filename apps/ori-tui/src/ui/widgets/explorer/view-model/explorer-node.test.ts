import { describe, expect, test } from "bun:test"
import { type Node, type NodeEdge, NodeType } from "@adapters/ori/client"
import {
  convertToExplorerNodes,
  createEdgeExplorerNode,
  type SnapshotExplorerNode,
} from "./explorer-node"

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

  if (kind === NodeType.SCHEMA) {
    return {
      id: overrides.id,
      type: kind,
      name,
      attributes: Object.assign({ resource: "test", engine: "postgres" }, overrides.attributes ?? {}),
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
            constraintType: "CHECK",
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

const getSnapshotNode = (node: Node): SnapshotExplorerNode => {
  const item = convertToExplorerNodes(node).find((child) => child.id === node.id)
  if (!item || item.kind !== "node") {
    throw new Error(`Missing snapshot node for ${node.id}`)
  }
  return item
}

describe("createSnapshotExplorerNode", () => {
  test("describes database nodes", () => {
    const node = getSnapshotNode(makeNode({ id: "db", type: NodeType.DATABASE, name: "main" }))
    expect(node.description).toBe("database")
  })

  test("describes schema nodes", () => {
    const node = getSnapshotNode(makeNode({ id: "schema", type: NodeType.SCHEMA, name: "public" }))
    expect(node.description).toBe("schema")
  })

  test("builds table snapshot node", () => {
    const node = makeNode({
      id: "table-1",
      type: NodeType.TABLE,
      name: "public.users",
      attributes: { table: "users" },
      edges: { columns: makeEdge(["col-1"]) },
    })
    const snapshotNode = getSnapshotNode(node)
    expect(snapshotNode).toEqual({
      id: "table-1",
      kind: "node",
      node,
      label: "public.users",
      description: "users",
      badges: [],
      childIds: ["edge:table-1:columns"],
      hasChildren: true,
    })
  })

  test("describes view nodes from attributes", () => {
    const view = getSnapshotNode(
      makeNode({
        id: "view-1",
        type: NodeType.VIEW,
        name: "public.active_users",
        attributes: { table: "active_users" },
      }),
    )
    expect(view.description).toBe("active_users")
  })

  test("describes columns and badges primary/!null", () => {
    const node = getSnapshotNode(
      makeNode({
        id: "col-1",
        type: NodeType.COLUMN,
        name: "id",
        attributes: { dataType: "uuid", primaryKeyPosition: 1, notNull: true },
      }),
    )
    expect(node.description).toBe("uuid")
    expect(node.badges).toEqual(["pk", "!null"])
  })

  test("describes CHECK constraints", () => {
    const node = getSnapshotNode(
      makeNode({
        id: "check-1",
        type: NodeType.CONSTRAINT,
        name: "amount_check",
        attributes: { constraintType: "CHECK", checkClause: "amount > 0" },
      }),
    )
    expect(node.description).toBe("amount > 0")
  })

  test("describes foreign key constraints and badges", () => {
    const node = getSnapshotNode(
      makeNode({
        id: "fk-1",
        type: NodeType.CONSTRAINT,
        name: "orders_user_id_fkey",
        attributes: {
          constraintType: "FOREIGN KEY",
          referencedSchema: "public",
          referencedTable: "users",
          match: "FULL",
          onUpdate: "CASCADE",
          onDelete: "RESTRICT",
        },
      }),
    )
    expect(node.description).toBe("references public.users")
    expect(node.badges).toEqual([])
  })

  test("describes UNIQUE constraints with index name", () => {
    const node = getSnapshotNode(
      makeNode({
        id: "uniq-1",
        type: NodeType.CONSTRAINT,
        name: "users_email_key",
        attributes: { constraintType: "UNIQUE", indexName: "users_email_idx" },
      }),
    )
    expect(node.description).toBe("index users_email_idx")
  })

  test("describes indexes with predicate and badges", () => {
    const node = getSnapshotNode(
      makeNode({
        id: "idx-1",
        type: NodeType.INDEX,
        name: "users_active_idx",
        attributes: { predicate: "active = true", primary: true, unique: true },
      }),
    )
    expect(node.description).toBe("where active = true")
    expect(node.badges).toEqual(["primary", "unique"])
  })

  test("describes triggers and badges", () => {
    const node = getSnapshotNode(
      makeNode({
        id: "trg-1",
        type: NodeType.TRIGGER,
        name: "users_audit",
        attributes: { timing: "BEFORE", events: ["INSERT", "UPDATE"], enabledState: "enabled" },
      }),
    )
    expect(node.description).toBeUndefined()
    expect(node.badges).toEqual(["enabled"])
  })
})

describe("createEdgeExplorerNode", () => {
  test("labels edges and counts items", () => {
    const node = makeNode({ id: "table-1", type: NodeType.TABLE, name: "users" })
    const edge = createEdgeExplorerNode(node, "columns", makeEdge(["col-1", "col-2"]))
    expect(edge.id).toBe("edge:table-1:columns")
    expect(edge.label).toBe("columns")
    expect(edge.description).toBe("2")
  })

  test("renders action rule edge label with spaces", () => {
    const node = makeNode({ id: "trg-1", type: NodeType.TRIGGER, name: "users_audit" })
    const edge = createEdgeExplorerNode(node, "action_rules", makeEdge(["rule-1"]))
    expect(edge.label).toBe("action rules")
  })

  test("renders truncated edge descriptions", () => {
    const node = makeNode({ id: "table-1", type: NodeType.TABLE, name: "users" })
    const zeroTruncated = createEdgeExplorerNode(node, "columns", makeEdge([], true))
    const manyTruncated = createEdgeExplorerNode(node, "columns", makeEdge(["c1", "c2"], true))
    expect(zeroTruncated.description).toBe("+ (truncated)")
    expect(manyTruncated.description).toBe("2+ (truncated)")
  })

  test("hides description for empty non-truncated edges", () => {
    const node = makeNode({ id: "table-1", type: NodeType.TABLE, name: "users" })
    const edge = createEdgeExplorerNode(node, "columns", makeEdge([], false))
    expect(edge.description).toBeUndefined()
  })
})
