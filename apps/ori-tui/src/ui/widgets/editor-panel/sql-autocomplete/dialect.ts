import { type Node, NodeType } from "@adapters/ori/client"

export type SqlDialectId = "generic" | "postgres" | "sqlite" | "duckdb"

export type SqlDialect = {
  id: SqlDialectId
  supportsSchemas: boolean
  keywords: readonly string[]
  functions: readonly string[]
  operators: readonly string[]
  tempTablePattern: RegExp
}

const BASE_KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "GROUP BY",
  "ORDER BY",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "JOIN",
  "LEFT JOIN",
  "RIGHT JOIN",
  "INNER JOIN",
  "OUTER JOIN",
  "FULL JOIN",
  "CROSS JOIN",
  "ON",
  "AS",
  "WITH",
  "RECURSIVE",
  "UNION",
  "UNION ALL",
  "INSERT INTO",
  "VALUES",
  "UPDATE",
  "SET",
  "DELETE FROM",
  "CREATE TABLE",
  "ALTER TABLE",
  "DROP TABLE",
  "DISTINCT",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "AND",
  "OR",
  "NOT",
  "NULL",
  "IN",
  "EXISTS",
  "BETWEEN",
  "LIKE",
  "IS",
  "TRUE",
  "FALSE",
  "ASC",
  "DESC",
] as const

const BASE_FUNCTIONS = [
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "COALESCE",
  "NULLIF",
  "LOWER",
  "UPPER",
  "TRIM",
  "SUBSTRING",
  "LENGTH",
  "ROUND",
  "NOW",
  "CURRENT_DATE",
  "CURRENT_TIMESTAMP",
  "ROW_NUMBER",
  "RANK",
  "DENSE_RANK",
  "LAG",
  "LEAD",
] as const

const BASE_OPERATORS = [
  "=",
  "!=",
  "<>",
  ">",
  ">=",
  "<",
  "<=",
  "IN",
  "NOT IN",
  "LIKE",
  "BETWEEN",
  "IS NULL",
  "IS NOT NULL",
] as const

function unique(values: readonly string[]) {
  return Array.from(new Set(values))
}

function createDialect(
  id: SqlDialectId,
  options: {
    supportsSchemas: boolean
    keywords?: readonly string[]
    functions?: readonly string[]
    operators?: readonly string[]
  },
): SqlDialect {
  return {
    id,
    supportsSchemas: options.supportsSchemas,
    keywords: unique([...BASE_KEYWORDS, ...(options.keywords ?? [])]),
    functions: unique([...BASE_FUNCTIONS, ...(options.functions ?? [])]),
    operators: unique([...BASE_OPERATORS, ...(options.operators ?? [])]),
    tempTablePattern:
      /\bcreate\s+(?:temp|temporary)\s+table\s+(?:if\s+not\s+exists\s+)?((?:"(?:[^"]|"")+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_$]*)(?:\s*\.\s*(?:"(?:[^"]|"")+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_$]*))?)/i,
  }
}

const DIALECTS: Record<SqlDialectId, SqlDialect> = {
  generic: createDialect("generic", {
    supportsSchemas: true,
  }),
  postgres: createDialect("postgres", {
    supportsSchemas: true,
    keywords: ["RETURNING", "ILIKE", "SIMILAR TO", "DISTINCT ON", "LATERAL", "MATERIALIZED", "UNNEST"],
    functions: ["DATE_TRUNC", "GENERATE_SERIES", "TO_CHAR", "JSONB_BUILD_OBJECT", "JSONB_AGG", "ARRAY_AGG"],
    operators: ["ILIKE", "SIMILAR TO", "ANY", "ALL", "@>", "<@", "?", "?|", "?&"],
  }),
  sqlite: createDialect("sqlite", {
    supportsSchemas: false,
    keywords: ["PRAGMA", "VACUUM", "GLOB", "RETURNING", "WITHOUT ROWID"],
    functions: ["IFNULL", "TOTAL", "JULIANDAY", "STRFTIME", "DATETIME", "GROUP_CONCAT", "PRINTF", "HEX", "RANDOMBLOB"],
    operators: ["GLOB", "MATCH", "REGEXP"],
  }),
  duckdb: createDialect("duckdb", {
    supportsSchemas: true,
    keywords: ["DESCRIBE", "SUMMARIZE", "PIVOT", "UNPIVOT", "SAMPLE", "RETURNING"],
    functions: ["DATE_PART", "DATE_DIFF", "LIST", "ARRAY_AGG", "UNNEST", "STRUCT_PACK"],
    operators: ["ILIKE", "SIMILAR TO"],
  }),
}

function normalizeEngine(value: string | undefined): SqlDialectId {
  const engine = value?.toLowerCase().trim()
  if (!engine) {
    return "generic"
  }
  if (engine.includes("postgres")) {
    return "postgres"
  }
  if (engine.includes("duckdb")) {
    return "duckdb"
  }
  if (engine.includes("sqlite")) {
    return "sqlite"
  }
  return "generic"
}

function getEngineNode(nodesById: Record<string, Node>, rootIds: string[]) {
  for (const id of rootIds) {
    const node = nodesById[id]
    if (!node) {
      continue
    }
    if (node.type === NodeType.DATABASE || node.type === NodeType.SCHEMA) {
      return node
    }
  }

  return Object.values(nodesById).find((node) => node.type === NodeType.DATABASE || node.type === NodeType.SCHEMA)
}

export function resolveSqlDialect(nodesById: Record<string, Node>, rootIds: string[]): SqlDialect {
  const node = getEngineNode(nodesById, rootIds)
  const id = normalizeEngine(node?.attributes.engine)
  return DIALECTS[id]
}
