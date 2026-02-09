import { describe, expect, test } from "bun:test"
import { NodeType, type Node, type NodeEdge } from "@shared/lib/configurations-client"
import { convertSnapshotNodeEntities } from "./tree-pane-graph"
import type { TreePaneNode } from "./tree-pane-node"

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
          constraintType: "FOREIGN KEY",
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

const edgeId = (nodeId: string, edgeName: string) => `edge:${nodeId}:${edgeName}`
const syntheticId = (nodeId: string, edgeName: string, index: number) => `synthetic:${nodeId}:${edgeName}:${index}`

const toEntityMap = (node: Node, nodes: Record<string, Node>) => {
  const map: Record<string, TreePaneNode> = {}
  for (const entity of convertSnapshotNodeEntities(node, nodes)) {
    map[entity.id] = entity
  }
  return map
}

describe("convertSnapshotNodeEntities", () => {
  test("creates edge entities for non-empty edges", () => {
    const db = makeNode({
      id: "db-1",
      type: NodeType.DATABASE,
      name: "main",
      edges: { tables: makeEdge(["table-1"]) },
    })
    const table = makeNode({ id: "table-1", type: NodeType.TABLE, name: "public.users" })

    const entities = toEntityMap(db, {
      [db.id]: db,
      [table.id]: table,
    })

    const dbEntity = entities[db.id]
    expect(dbEntity?.kind).toBe("node")
    expect(dbEntity?.childIds).toEqual([edgeId(db.id, "tables")])

    const tablesEdge = entities[edgeId(db.id, "tables")]
    expect(tablesEdge?.kind).toBe("edge")
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

    const entities = toEntityMap(db, { [db.id]: db })

    const dbEntity = entities[db.id]
    expect(dbEntity?.childIds).toEqual([])
    expect(entities[edgeId(db.id, "tables")]).toBeUndefined()
    expect(entities[edgeId(db.id, "views")]).toBeUndefined()
  })

  test("creates synthetic edges for index columns and includeColumns", () => {
    const index = makeNode({
      id: "idx-1",
      type: NodeType.INDEX,
      name: "users_idx",
      attributes: { columns: ["id", "email"], includeColumns: ["created_at"] },
    })

    const entities = toEntityMap(index, { [index.id]: index })

    const indexEntity = entities[index.id]
    expect(indexEntity?.childIds).toEqual([edgeId(index.id, "columns"), edgeId(index.id, "include")])

    const columnsEdge = entities[edgeId(index.id, "columns")]
    const includeEdge = entities[edgeId(index.id, "include")]
    expect(columnsEdge?.childIds).toEqual([syntheticId(index.id, "columns", 0), syntheticId(index.id, "columns", 1)])
    expect(includeEdge?.childIds).toEqual([syntheticId(index.id, "include", 0)])

    const firstColumn = entities[syntheticId(index.id, "columns", 0)]
    const secondColumn = entities[syntheticId(index.id, "columns", 1)]
    const includeColumn = entities[syntheticId(index.id, "include", 0)]
    expect(firstColumn?.label).toBe("id")
    expect(secondColumn?.label).toBe("email")
    expect(includeColumn?.label).toBe("created_at")
  })

  test("creates synthetic edges for constraint columns and references", () => {
    const constraint = makeNode({
      id: "fk-1",
      type: NodeType.CONSTRAINT,
      name: "orders_user_id_fkey",
      attributes: { columns: ["user_id"], referencedColumns: ["users.id"] },
    })

    const entities = toEntityMap(constraint, { [constraint.id]: constraint })

    const constraintEntity = entities[constraint.id]
    expect(constraintEntity?.childIds).toEqual([edgeId(constraint.id, "columns"), edgeId(constraint.id, "references")])

    const columnsEdge = entities[edgeId(constraint.id, "columns")]
    const referencesEdge = entities[edgeId(constraint.id, "references")]
    expect(columnsEdge?.childIds).toEqual([syntheticId(constraint.id, "columns", 0)])
    expect(referencesEdge?.childIds).toEqual([syntheticId(constraint.id, "references", 0)])
  })

  test("skips synthetic edges when arrays are empty", () => {
    const index = makeNode({
      id: "idx-1",
      type: NodeType.INDEX,
      name: "users_idx",
      attributes: { columns: [] },
    })

    const entities = toEntityMap(index, { [index.id]: index })

    const indexEntity = entities[index.id]
    expect(indexEntity?.childIds).toEqual([])
    expect(entities[edgeId(index.id, "columns")]).toBeUndefined()
  })
})
