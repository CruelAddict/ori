import { describe, expect, test } from "bun:test"
import type { Node, NodeEdge } from "@shared/lib/configurations-client"
import { createEdgeTreePaneNode, createSnapshotTreePaneNode } from "./tree-pane-node"

const makeNode = (overrides: Partial<Node> & { id: string }): Node => ({
  id: overrides.id,
  type: overrides.type ?? "table",
  name: overrides.name ?? overrides.id,
  attributes: overrides.attributes ?? {},
  edges: overrides.edges ?? {},
})

const makeEdge = (items: string[], truncated = false): NodeEdge => ({
  items,
  truncated,
})

describe("createSnapshotTreePaneNode", () => {
  test("describes database nodes", () => {
    const entity = createSnapshotTreePaneNode(makeNode({ id: "db", type: "database", name: "main" }))
    expect(entity.description).toBe("database")
  })

  test("describes table and view nodes from attributes", () => {
    const table = createSnapshotTreePaneNode(
      makeNode({
        id: "table-1",
        type: "table",
        name: "public.users",
        attributes: { table: "users" },
      }),
    )
    const view = createSnapshotTreePaneNode(
      makeNode({
        id: "view-1",
        type: "view",
        name: "public.active_users",
        attributes: { table: "active_users" },
      }),
    )
    expect(table.description).toBe("users")
    expect(view.description).toBe("active_users")
  })

  test("describes columns and badges primary/not null", () => {
    const entity = createSnapshotTreePaneNode(
      makeNode({
        id: "col-1",
        type: "column",
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
        type: "constraint",
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
        type: "constraint",
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
    expect(entity.description).toBe("FOREIGN KEY -> public.users")
    expect(entity.badges).toEqual(["MATCH FULL", "ON UPDATE CASCADE", "ON DELETE RESTRICT"])
  })

  test("describes UNIQUE constraints with index name", () => {
    const entity = createSnapshotTreePaneNode(
      makeNode({
        id: "uniq-1",
        type: "constraint",
        name: "users_email_key",
        attributes: { constraintType: "UNIQUE", indexName: "users_email_idx" },
      }),
    )
    expect(entity.description).toBe("UNIQUE (index users_email_idx)")
  })

  test("describes indexes with predicate and badges", () => {
    const entity = createSnapshotTreePaneNode(
      makeNode({
        id: "idx-1",
        type: "index",
        name: "users_active_idx",
        attributes: { predicate: "active = true", primary: true, unique: true },
      }),
    )
    expect(entity.description).toBe("where active = true")
    expect(entity.badges).toEqual(["PRIMARY", "UNIQUE"])
  })

  test("describes triggers and badges", () => {
    const entity = createSnapshotTreePaneNode(
      makeNode({
        id: "trg-1",
        type: "trigger",
        name: "users_audit",
        attributes: { timing: "BEFORE", events: ["INSERT", "UPDATE"], enabledState: "enabled" },
      }),
    )
    expect(entity.description).toBe("BEFORE INSERT OR UPDATE")
    expect(entity.badges).toEqual(["ENABLED"])
  })
})

describe("createEdgeTreePaneNode", () => {
  test("labels edges and counts items", () => {
    const node = makeNode({ id: "table-1", type: "table", name: "users" })
    const edge = createEdgeTreePaneNode(node, "columns", makeEdge(["col-1", "col-2"]))
    expect(edge.id).toBe("edge:table-1:columns")
    expect(edge.label).toBe("columns")
    expect(edge.description).toBe("2 items")
  })

  test("renders truncated edge descriptions", () => {
    const node = makeNode({ id: "table-1", type: "table", name: "users" })
    const zeroTruncated = createEdgeTreePaneNode(node, "columns", makeEdge([], true))
    const manyTruncated = createEdgeTreePaneNode(node, "columns", makeEdge(["c1", "c2"], true))
    expect(zeroTruncated.description).toBe("+ items (truncated)")
    expect(manyTruncated.description).toBe("2+ items (truncated)")
  })

  test("hides description for empty non-truncated edges", () => {
    const node = makeNode({ id: "table-1", type: "table", name: "users" })
    const edge = createEdgeTreePaneNode(node, "columns", makeEdge([], false))
    expect(edge.description).toBeUndefined()
  })
})
