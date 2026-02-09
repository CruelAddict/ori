import { describe, expect, test } from "bun:test"
import { NodeType, type Node, type NodeEdge } from "@shared/lib/configurations-client"
import { createEdgeTreePaneNode, createSnapshotTreePaneNode } from "./tree-pane-node"

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
      attributes: Object.assign({ connection: "test", engine: "sqlite" }, overrides.attributes ?? {}),
      edges: overrides.edges ?? {},
    } as Node
  }

  if (kind === NodeType.SCHEMA) {
    return {
      id: overrides.id,
      type: kind,
      name,
      attributes: Object.assign({ connection: "test", engine: "postgres" }, overrides.attributes ?? {}),
      edges: overrides.edges ?? {},
    } as Node
  }

  if (kind === NodeType.COLUMN) {
    return {
      id: overrides.id,
      type: kind,
      name,
      attributes: {
        ...Object.assign({
          connection: "test",
          table: "users",
          column: name,
          ordinal: 1,
          dataType: "text",
          notNull: false,
        }, overrides.attributes ?? {}),
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
        ...Object.assign({
          connection: "test",
          table: "users",
          constraintName: name,
          constraintType: "CHECK",
        }, overrides.attributes ?? {}),
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
        ...Object.assign({
          connection: "test",
          table: "users",
          indexName: name,
          unique: false,
          primary: false,
        }, overrides.attributes ?? {}),
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
        ...Object.assign({
          connection: "test",
          table: "users",
          triggerName: name,
          timing: "BEFORE",
          orientation: "ROW",
        }, overrides.attributes ?? {}),
      },
      edges: overrides.edges ?? {},
    } as Node
  }

  if (kind === NodeType.VIEW) {
    return {
      id: overrides.id,
      type: kind,
      name,
      attributes: Object.assign({ connection: "test", table: name, tableType: "view" }, overrides.attributes ?? {}),
      edges: overrides.edges ?? {},
    } as Node
  }

  return {
    id: overrides.id,
    type: kind,
    name,
    attributes: Object.assign({ connection: "test", table: name, tableType: "table" }, overrides.attributes ?? {}),
    edges: overrides.edges ?? {},
  } as Node
}

const makeEdge = (items: string[], truncated = false): NodeEdge => ({
  items,
  truncated,
})

describe("createSnapshotTreePaneNode", () => {
  test("describes database nodes", () => {
    const entity = createSnapshotTreePaneNode(makeNode({ id: "db", type: NodeType.DATABASE, name: "main" }))
    expect(entity.description).toBe("database")
  })

  test("describes schema nodes", () => {
    const entity = createSnapshotTreePaneNode(makeNode({ id: "schema", type: NodeType.SCHEMA, name: "public" }))
    expect(entity.description).toBe("schema")
  })

  test("builds table snapshot node", () => {
    const node = makeNode({
      id: "table-1",
      type: NodeType.TABLE,
      name: "public.users",
      attributes: { table: "users" },
      edges: { columns: makeEdge(["col-1"]) },
    })
    const entity = createSnapshotTreePaneNode(node)
    expect(entity).toEqual({
      id: "table-1",
      kind: "node",
      node,
      label: "public.users",
      description: "users",
      badges: [],
      childIds: [],
      hasChildren: false,
    })
  })

  test("describes view nodes from attributes", () => {
    const view = createSnapshotTreePaneNode(
      makeNode({
        id: "view-1",
        type: NodeType.VIEW,
        name: "public.active_users",
        attributes: { table: "active_users" },
      }),
    )
    expect(view.description).toBe("active_users")
  })

  test("describes columns and badges primary/not null", () => {
    const entity = createSnapshotTreePaneNode(
      makeNode({
        id: "col-1",
        type: NodeType.COLUMN,
        name: "id",
        attributes: { dataType: "uuid", primaryKeyPosition: 1, notNull: true },
      }),
    )
    expect(entity.description).toBe("uuid")
    expect(entity.badges).toEqual(["PK", "NOT NULL"])
  })

  test("describes CHECK constraints", () => {
    const entity = createSnapshotTreePaneNode(
      makeNode({
        id: "check-1",
        type: NodeType.CONSTRAINT,
        name: "amount_check",
        attributes: { constraintType: "CHECK", checkClause: "amount > 0" },
      }),
    )
    expect(entity.description).toBe("amount > 0")
  })

  test("describes foreign key constraints and badges", () => {
    const entity = createSnapshotTreePaneNode(
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
    expect(entity.description).toBe("foreigh key: public.users")
    expect(entity.badges).toEqual(["match FULL", "on update CASCADE", "on delete RESTRICT"])
  })

  test("describes UNIQUE constraints with index name", () => {
    const entity = createSnapshotTreePaneNode(
      makeNode({
        id: "uniq-1",
        type: NodeType.CONSTRAINT,
        name: "users_email_key",
        attributes: { constraintType: "UNIQUE", indexName: "users_email_idx" },
      }),
    )
    expect(entity.description).toBe("unique (index users_email_idx)")
  })

  test("describes indexes with predicate and badges", () => {
    const entity = createSnapshotTreePaneNode(
      makeNode({
        id: "idx-1",
        type: NodeType.INDEX,
        name: "users_active_idx",
        attributes: { predicate: "active = true", primary: true, unique: true },
      }),
    )
    expect(entity.description).toBe("where active = true")
    expect(entity.badges).toEqual(["primary", "unique"])
  })

  test("describes triggers and badges", () => {
    const entity = createSnapshotTreePaneNode(
      makeNode({
        id: "trg-1",
        type: NodeType.TRIGGER,
        name: "users_audit",
        attributes: { timing: "BEFORE", events: ["INSERT", "UPDATE"], enabledState: "enabled" },
      }),
    )
    expect(entity.description).toBe("BEFORE INSERT or UPDATE")
    expect(entity.badges).toEqual(["ENABLED"])
  })
})

describe("createEdgeTreePaneNode", () => {
  test("labels edges and counts items", () => {
    const node = makeNode({ id: "table-1", type: NodeType.TABLE, name: "users" })
    const edge = createEdgeTreePaneNode(node, "columns", makeEdge(["col-1", "col-2"]))
    expect(edge.id).toBe("edge:table-1:columns")
    expect(edge.label).toBe("columns")
    expect(edge.description).toBe("2")
  })

  test("renders truncated edge descriptions", () => {
    const node = makeNode({ id: "table-1", type: NodeType.TABLE, name: "users" })
    const zeroTruncated = createEdgeTreePaneNode(node, "columns", makeEdge([], true))
    const manyTruncated = createEdgeTreePaneNode(node, "columns", makeEdge(["c1", "c2"], true))
    expect(zeroTruncated.description).toBe("+ (truncated)")
    expect(manyTruncated.description).toBe("2+ (truncated)")
  })

  test("hides description for empty non-truncated edges", () => {
    const node = makeNode({ id: "table-1", type: NodeType.TABLE, name: "users" })
    const edge = createEdgeTreePaneNode(node, "columns", makeEdge([], false))
    expect(edge.description).toBeUndefined()
  })
})
