import { type Node, NodeType } from "../../../../adapters/ori/client"

export type SqlSchemaInput = {
  nodesById: Record<string, Node>
  rootIds: string[]
  loading: boolean
  loaded: boolean
}

export type SqlRelationKind = "table" | "view"

export type SqlColumn = {
  id: string
  name: string
  dataType?: string
}

export type SqlRelation = {
  id: string
  name: string
  kind: SqlRelationKind
  database?: string
  schema?: string
  fullName: string
  columns: SqlColumn[]
}

export type SqlSchemaIndex = {
  relations: SqlRelation[]
  loading: boolean
  loaded: boolean
  versionKey: string
  findRelations: (name: string) => SqlRelation[]
  findRelationsInSchema: (schemaName: string) => SqlRelation[]
}

export function getSqlSchemaInputVersionKey(input: SqlSchemaInput) {
  return `${Object.keys(input.nodesById).length}:${input.rootIds.join(",")}:${input.loading ? 1 : 0}:${input.loaded ? 1 : 0}`
}

type Lookup = Map<string, SqlRelation[]>

function pushLookup(lookup: Lookup, key: string | undefined, relation: SqlRelation) {
  if (!key) {
    return
  }

  const normalized = key.toLowerCase()
  const current = lookup.get(normalized)
  if (current) {
    current.push(relation)
    return
  }

  lookup.set(normalized, [relation])
}

function buildParentById(input: SqlSchemaInput) {
  const parentById: Record<string, string> = {}
  const queue = [...input.rootIds]
  const seen = new Set(queue)

  while (queue.length > 0) {
    const id = queue.shift()
    if (!id) {
      continue
    }

    const node = input.nodesById[id]
    if (!node) {
      continue
    }

    for (const edge of Object.values(node.edges ?? {})) {
      for (const childId of edge.items) {
        if (parentById[childId] === undefined) {
          parentById[childId] = id
        }
        if (seen.has(childId)) {
          continue
        }
        seen.add(childId)
        queue.push(childId)
      }
    }
  }

  return parentById
}

function findAncestor(
  parentById: Record<string, string>,
  nodesById: Record<string, Node>,
  nodeId: string,
  type: Node["type"],
) {
  let current = parentById[nodeId]
  for (; current; current = parentById[current]) {
    const node = nodesById[current]
    if (!node) {
      continue
    }
    if (node.type === type) {
      return node
    }
  }
}

function isDefaultSchema(node: Node | undefined) {
  if (!node?.attributes) {
    return false
  }

  if (!("isDefault" in node.attributes)) {
    return false
  }

  return Boolean(node.attributes.isDefault)
}

function createRelation(
  node: Extract<Node, { type: "table" | "view" }>,
  input: SqlSchemaInput,
  parentById: Record<string, string>,
): SqlRelation {
  const databaseNode = findAncestor(parentById, input.nodesById, node.id, NodeType.DATABASE)
  const schemaNode = findAncestor(parentById, input.nodesById, node.id, NodeType.SCHEMA)
  const columns = (node.edges?.columns?.items ?? [])
    .map((id) => input.nodesById[id])
    .filter((column): column is Extract<Node, { type: "column" }> => Boolean(column) && column.type === NodeType.COLUMN)
    .map((column) => ({
      id: column.id,
      name: column.name,
      dataType: column.attributes?.dataType,
    }))

  const database = databaseNode?.name
  const schema = schemaNode?.name
  return {
    id: node.id,
    name: node.name,
    kind: node.type,
    database,
    schema,
    fullName: [database, schema, node.name].filter(Boolean).join("."),
    columns,
  }
}

export function buildSqlSchemaIndex(input: SqlSchemaInput): SqlSchemaIndex {
  const parentById = buildParentById(input)
  const relationLookup: Lookup = new Map()
  const schemaLookup: Lookup = new Map()
  const relations = Object.values(input.nodesById)
    .filter(
      (node): node is Extract<Node, { type: "table" | "view" }> =>
        node.type === NodeType.TABLE || node.type === NodeType.VIEW,
    )
    .map((node) => {
      const schemaNode = findAncestor(parentById, input.nodesById, node.id, NodeType.SCHEMA)
      return {
        relation: createRelation(node, input, parentById),
        schemaIsDefault: isDefaultSchema(schemaNode),
      }
    })
    .sort((a, b) => {
      if (a.schemaIsDefault !== b.schemaIsDefault) {
        return a.schemaIsDefault ? -1 : 1
      }
      return a.relation.fullName.localeCompare(b.relation.fullName)
    })
    .map((entry) => entry.relation)

  for (const relation of relations) {
    pushLookup(relationLookup, relation.name, relation)
    pushLookup(relationLookup, relation.schema ? `${relation.schema}.${relation.name}` : undefined, relation)
    pushLookup(relationLookup, relation.fullName, relation)
    pushLookup(schemaLookup, relation.schema, relation)
  }

  return {
    relations,
    loading: input.loading,
    loaded: input.loaded,
    versionKey: getSqlSchemaInputVersionKey(input),
    findRelations: (name: string) => relationLookup.get(name.toLowerCase()) ?? [],
    findRelationsInSchema: (schemaName: string) => schemaLookup.get(schemaName.toLowerCase()) ?? [],
  }
}
