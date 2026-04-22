import { describe, expect, test } from "bun:test"
import { type Node, NodeType } from "@adapters/ori/client"
import { buildLineStarts } from "@utils/line-offsets"
import { resolveSqlDialect } from "./sql-autocomplete/dialect"
import { getCurrentSqlStatement } from "./sql-autocomplete/sql-context"
import { createSqlAutocompleteProvider } from "./sql-autocomplete/provider"
import { getSqlAutocompleteResult } from "./sql-autocomplete/sql-engine"
import { buildSqlSchemaIndex, type SqlSchemaInput } from "./sql-autocomplete/sql-schema-index"
import { collectSqlStatements } from "./sql-statement-detector"

type CatalogShape = Record<string, Record<string, string[]>>
type TestState = SqlSchemaInput

const DEFAULT_CATALOG: CatalogShape = {
  public: {
    users: ["id", "email", "created_at"],
    orders: ["id", "user_id", "status"],
  },
  analytics: {
    books: ["id", "title"],
  },
}

function withCursor(sql: string) {
  const cursor = sql.indexOf("|")
  if (cursor === -1) {
    throw new Error(`Missing cursor marker in ${sql}`)
  }

  return {
    text: sql.slice(0, cursor) + sql.slice(cursor + 1),
    cursor,
  }
}

function catalog(shape: CatalogShape = DEFAULT_CATALOG, engine = "postgres"): TestState {
  const databaseId = "db"
  const nodes: Node[] = [
    {
      id: databaseId,
      name: engine === "sqlite" ? "main" : "warehouse",
      type: NodeType.DATABASE,
      edges: { schemas: { items: [], truncated: false } },
      attributes: { resource: "test", engine, isDefault: true },
    } as Extract<Node, { type: "database" }>,
  ]

  for (const [schemaName, tables] of Object.entries(shape)) {
    const schemaId = `schema:${schemaName}`
    ;(nodes[0] as Extract<Node, { type: "database" }>).edges.schemas.items.push(schemaId)
    nodes.push({
      id: schemaId,
      name: schemaName,
      type: NodeType.SCHEMA,
      edges: { tables: { items: [], truncated: false } },
      attributes: { resource: "test", engine, isDefault: schemaName === "public" },
    } as Extract<Node, { type: "schema" }>)

    for (const [tableName, columns] of Object.entries(tables)) {
      const tableId = `table:${schemaName}.${tableName}`
      const schemaNode = nodes.find((node) => node.id === schemaId) as Extract<Node, { type: "schema" }>
      schemaNode.edges.tables.items.push(tableId)
      nodes.push({
        id: tableId,
        name: tableName,
        type: NodeType.TABLE,
        edges: { columns: { items: [], truncated: false } },
        attributes: { resource: "test", table: tableName, tableType: "table" },
      } as Extract<Node, { type: "table" }>)

      for (const [index, columnName] of columns.entries()) {
        const columnId = `column:${schemaName}.${tableName}.${columnName}`
        const tableNode = nodes.find((node) => node.id === tableId) as Extract<Node, { type: "table" }>
        tableNode.edges.columns.items.push(columnId)
        nodes.push({
          id: columnId,
          name: columnName,
          type: NodeType.COLUMN,
          edges: {},
          attributes: {
            resource: "test",
            table: tableName,
            column: columnName,
            ordinal: index + 1,
            dataType: columnName.endsWith("_at") ? "timestamp" : columnName === "id" ? "integer" : "text",
            notNull: columnName === "id",
          },
        } as Extract<Node, { type: "column" }>)
      }
    }
  }

  return {
    rootIds: [databaseId],
    nodesById: Object.fromEntries(nodes.map((node) => [node.id, node])),
    loading: false,
    loaded: true,
  }
}

function complete(sql: string, state = catalog()) {
  const query = withCursor(sql)
  return getSqlAutocompleteResult({
    text: query.text,
    cursorOffset: query.cursor,
    dialect: resolveSqlDialect(state.nodesById, state.rootIds),
    schema: buildSqlSchemaIndex(state),
  })
}

function labels(result: ReturnType<typeof getSqlAutocompleteResult>) {
  return result?.items.map((item) => item.label) ?? []
}

function expectIncludes(result: ReturnType<typeof getSqlAutocompleteResult>, values: string[]) {
  const current = labels(result)
  for (const value of values) {
    expect(current).toContain(value)
  }
}

function expectExcludes(result: ReturnType<typeof getSqlAutocompleteResult>, values: string[]) {
  const current = labels(result)
  for (const value of values) {
    expect(current).not.toContain(value)
  }
}

function expectOnly(result: ReturnType<typeof getSqlAutocompleteResult>, values: string[]) {
  expect(labels(result)).toEqual(values)
}

function replaceText(sql: string, result: ReturnType<typeof getSqlAutocompleteResult>) {
  if (!result) {
    return undefined
  }
  const query = withCursor(sql)
  return query.text.slice(result.replace.start, result.replace.end)
}

function currentStatement(sql: string) {
  const query = withCursor(sql)
  return getCurrentSqlStatement(query.text, query.cursor)?.text
}

describe("sql autocomplete", () => {
  describe("statement scope", () => {
    test("collects statement spans with offsets", () => {
      const sql = "SELECT 1;\n\nSELECT 2;\n"
      const spans = collectSqlStatements(sql, buildLineStarts(sql)).map((item) => ({
        start: sql.slice(item.start, item.end),
        startLine: item.startLine,
        endLine: item.endLine,
      }))

      expect(spans).toEqual([
        { start: "SELECT 1;", startLine: 0, endLine: 0 },
        { start: "SELECT 2;", startLine: 2, endLine: 2 },
      ])
    })

    test("finds current statement on the same line", () => {
      expect(currentStatement("SELECT 1; SELECT |")).toBe("SELECT ")
      expect(currentStatement("SELECT |; SELECT 2")).toBe("SELECT ;")
    })

    test("returns nothing in whitespace gap between statements", () => {
      expect(currentStatement("SELECT 1;   |   SELECT 2")).toBeUndefined()
    })

    test("keeps leading comment inside the current statement slice", () => {
      expect(currentStatement("-- hi\nSELECT |")).toBe("-- hi\nSELECT ")
    })

    test("recognizes dialect starters like VALUES and PRAGMA", () => {
      const sql = "VALUES (1);\nPRAGMA table_info(users);"
      const spans = collectSqlStatements(sql, buildLineStarts(sql)).map((item) => sql.slice(item.start, item.end))
      expect(spans).toEqual(["VALUES (1);", "PRAGMA table_info(users);"])
    })
  })

  describe("opening behavior", () => {
    test("suggests SELECT for an incomplete top-level keyword", () => {
      const result = complete("sel|")
      expect(labels(result)[0]).toBe("select")
      expect(replaceText("sel|", result)).toBe("sel")
    })

    test("suggests upper-case keyword for upper-case prefix", () => {
      const result = complete("SEL|")
      expect(labels(result)[0]).toBe("SELECT")
    })

    test("rounds mixed-case keyword prefix up to upper-case", () => {
      const result = complete("SeL|")
      expect(labels(result)[0]).toBe("SELECT")
    })

    test("stays closed on an empty line", () => {
      expect(complete("|")).toBeUndefined()
    })

    test("stays closed after SELECT space without structural trigger", () => {
      expect(complete("select |")).toBeUndefined()
    })

    test("opens after FROM space", () => {
      const result = complete("select * from |")
      expectIncludes(result, ["users", "orders", "books"])
    })

    test("suggests INTO after INSERT space", () => {
      expectOnly(complete("insert |"), ["into"])
    })
  })

  describe("relations", () => {
    test("suggests relations in FROM clause", () => {
      const result = complete("select * from us|")
      expectIncludes(result, ["users"])
      expectExcludes(result, ["email"])
      expect(replaceText("select * from us|", result)).toBe("us")
    })

    test("does not suggest an exact relation match as a no-op completion", () => {
      const result = complete("select * from users|")
      expectExcludes(result, ["users"])
    })

    test("matches trigger-case from the last keyword on lower-case lookback", () => {
      expectOnly(complete("select * from users w|"), ["where"])
    })

    test("matches trigger-case from the last keyword on upper-case lookback", () => {
      expectOnly(complete("SELECT * FROM users W|"), ["WHERE"])
    })

    test("suggests ON after a completed JOIN relation", () => {
      expectOnly(complete("select * from users join orders o|"), ["on"])
    })

    test("suggests relations in schema scope", () => {
      const result = complete("select * from analytics.bo|")
      expect(labels(result)[0]).toBe("books")
      expect(replaceText("select * from analytics.bo|", result)).toBe("bo")
    })

    test("does not offer schema member completion for sqlite", () => {
      const result = complete("select * from main.us|", catalog(DEFAULT_CATALOG, "sqlite"))
      expect(result).toBeUndefined()
    })

    test("suggests relations inside a nested subquery FROM clause", () => {
      const result = complete("select * from users where email in (select email from |)")
      expectIncludes(result, ["users", "orders", "books"])
      expectExcludes(result, ["email"])
    })
  })

  describe("columns and expressions", () => {
    test("suggests alias columns after dot", () => {
      const result = complete("select u.| from users u")
      expectIncludes(result, ["id", "email", "created_at"])
      expectExcludes(result, ["users"])
    })

    test("suggests columns in WHERE", () => {
      const result = complete("select * from users where em|")
      expectIncludes(result, ["email"])
      expectExcludes(result, ["users"])
    })

    test("keeps WHERE suggestions inside parentheses without a nested query", () => {
      const result = complete("select * from users where (em|)")
      expectIncludes(result, ["email"])
      expectExcludes(result, ["users"])
    })

    test("suggests inner query columns inside a nested WHERE clause", () => {
      const result = complete("select * from users where exists (select 1 from orders where |)")
      expectIncludes(result, ["id", "user_id", "status"])
      expectExcludes(result, ["users", "orders"])
    })

    test("suggests cte columns in the outer query scope", () => {
      const result = complete("with recent as (select id, email from users) select em| from recent")
      expectIncludes(result, ["email"])
      expectExcludes(result, ["created_at"])
    })

    test("does not suggest a cte inside its own query body", () => {
      const result = complete("with recent as (select * from re|) select * from recent")
      expectExcludes(result, ["recent"])
    })

    test("keeps cte projections visible in the outer query without leaking source columns", () => {
      const result = complete("with recent as (select email as www from authors) select w| from recent", {
        ...catalog({ public: { authors: ["id", "email", "name"] } }),
      })
      expectIncludes(result, ["www"])
      expectExcludes(result, ["email", "name"])
    })

    test("keeps implicit cte projection aliases visible in the outer query", () => {
      const result = complete("with recent as (select email iii from authors) select ii| from recent", {
        ...catalog({ public: { authors: ["id", "email", "name"] } }),
      })
      expectIncludes(result, ["iii"])
      expectExcludes(result, ["email", "name"])
    })

    test("keeps implicit cte projection aliases visible before an incomplete outer FROM relation", () => {
      const result = complete("with recent as (select email iii from authors) select ii| from re", {
        ...catalog({ public: { authors: ["id", "email", "name"] } }),
      })
      expectIncludes(result, ["iii"])
      expect(labels(result)[0]).toBe("iii")
    })

    test("does not leak cte source columns into an outer select before FROM", () => {
      const result = complete("with recent as (select email as www from authors) select w|", {
        ...catalog({ public: { authors: ["id", "email", "name"] } }),
      })
      expectExcludes(result, ["email", "name", "www"])
    })

    test("suggests derived table columns after dot", () => {
      const result = complete("select sub.| from (select email from users) sub")
      expectIncludes(result, ["email"])
      expectExcludes(result, ["created_at"])
    })

    test("suggests derived table aliases in select expressions", () => {
      const result = complete("select s| from (select email from users) sub")
      expectIncludes(result, ["sub"])
    })

    test("suggests quoted alias columns and preserves quoted insert text", () => {
      const result = complete(
        'select "u".| from users as "u"',
        catalog({ public: { users: ["id", "EmailAddress"] }, analytics: { books: ["id", "title"] } }),
      )
      expectIncludes(result, ["id", "EmailAddress"])
      expect(result?.items.find((item) => item.label === "EmailAddress")?.insertText).toBe('"EmailAddress"')
    })

    test("resolves 3-part relation names for column suggestions", () => {
      const result = complete("select em| from warehouse.public.users")
      expectIncludes(result, ["email"])
      expectExcludes(result, ["status"])
    })

    test("prefers FROM after SELECT star prefix", () => {
      expectOnly(complete("select * fr|"), ["from"])
    })

    test("prefers frequent SELECT over shorter SET for a shared prefix", () => {
      const result = complete("se|")
      const current = labels(result)
      expect(current.indexOf("select")).toBeLessThan(current.indexOf("set"))
    })

    test("prefers frequent WHERE over WHEN for a shared prefix", () => {
      const result = complete("wh|")
      const current = labels(result)
      expect(current.indexOf("where")).toBeLessThan(current.indexOf("when"))
    })

    test("ranks operator keyword before similarly matching function", () => {
      const result = complete("select * from users where is n|")
      const current = labels(result)
      expect(current.indexOf("is null")).toBeLessThan(current.indexOf("nullif"))
    })

    test("formats functions in lower-case for lower-case prefixes", () => {
      const result = complete("select co|")
      expectIncludes(result, ["count", "coalesce"])
    })

    test("formats functions in upper-case for upper-case prefixes", () => {
      const result = complete("SELECT CO|")
      expectIncludes(result, ["COUNT", "COALESCE"])
    })

    test("suggests only INTO after INSERT prefix", () => {
      expectOnly(complete("insert in|"), ["into"])
    })

    test("suggests only INTO after upper-case INSERT prefix", () => {
      expectOnly(complete("INSERT IN|"), ["INTO"])
    })

    test("suggests only FROM after DELETE prefix", () => {
      expectOnly(complete("delete fr|"), ["from"])
    })

    test("suggests insert follow-up keywords after the target relation", () => {
      const result = complete("insert into users |")
      expectIncludes(result, ["values", "select", "default values"])
      expectExcludes(result, ["users"])
      expectExcludes(result, ["("])
    })

    test("stays closed at the end of the insert target relation without whitespace", () => {
      expect(complete("insert into users|")).toBeUndefined()
    })

    test("does not fall back to relation names after an insert target relation", () => {
      expect(complete("insert into users u|")).toBeUndefined()
    })

    test("suggests insert target columns inside the column list", () => {
      const result = complete("insert into users (|")
      expectIncludes(result, ["id", "email", "created_at"])
      expectExcludes(result, ["users"])
    })

    test("skips already listed insert target columns", () => {
      const result = complete("insert into users (id, |")
      expectIncludes(result, ["email", "created_at"])
      expectExcludes(result, ["id"])
    })

    test("suggests SET after UPDATE relation", () => {
      expectOnly(complete("update users s|"), ["set"])
    })

    test("limits DELETE follow-up keywords to delete-specific options", () => {
      const result = complete("delete from users |")
      expectIncludes(result, ["where", "returning"])
      expectExcludes(result, ["join", "group by", "order by", "union"])
    })

    test("suggests LIMIT after grouped expressions", () => {
      const result = complete("with recent as (select email iii from authors) select iii from recent group by iii li|", {
        ...catalog({ public: { authors: ["id", "email", "name"] } }),
      })
      expectIncludes(result, ["limit"])
      const current = labels(result)
      expect(current.indexOf("limit")).toBeLessThan(current.indexOf("nullif"))
    })

    test("stays closed after LIMIT when the next token must be numeric", () => {
      expect(complete("with asd as (select email as www from authors) select www from asd limit |", {
        ...catalog({ public: { authors: ["id", "email", "name"] } }),
      })).toBeUndefined()
    })

    test("stays closed after a LIMIT value", () => {
      expect(complete("with asd as (select email as www from authors) select www from asd limit 10|", {
        ...catalog({ public: { authors: ["id", "email", "name"] } }),
      })).toBeUndefined()
    })
  })

  describe("ctes and temp tables", () => {
    test("suggests cte names inside the current statement", () => {
      const result = complete("with recent as (select * from users) select * from re|")
      expectIncludes(result, ["recent"])
    })

    test("does not leak ctes from previous statements", () => {
      const result = complete("with recent as (select * from users) select * from recent; select * from re|")
      expectExcludes(result, ["recent"])
    })

    test("suggests previous temp tables in FROM clause", () => {
      const result = complete("create temp table temp_users as select * from users; select * from temp_|")
      expectIncludes(result, ["temp_users"])
    })

    test("does not look ahead for temp tables", () => {
      const result = complete("select * from temp_|; create temp table temp_users as select * from users")
      expectExcludes(result, ["temp_users"])
    })
  })

  describe("statement isolation", () => {
    test("does not use previous statement relations for column suggestions", () => {
      const result = complete("select * from users; select em|")
      expectExcludes(result, ["email"])
      expect(result).not.toBeUndefined()
    })

    test("does not use next statement while typing in current one", () => {
      const result = complete("select * from us|; select * from orders")
      expectIncludes(result, ["users"])
      expectExcludes(result, ["status"])
    })
  })

  describe("suppressed regions", () => {
    test("stays closed inside strings", () => {
      expect(complete("select '|' ")).toBeUndefined()
    })

    test("stays closed inside comments", () => {
      expect(complete("select 1 -- |comment")).toBeUndefined()
    })

    test("stays closed inside dollar-quoted text", () => {
      expect(complete("select $$|$$")).toBeUndefined()
    })
  })

  describe("dialects", () => {
    test("offers postgres-specific functions", () => {
      const result = complete("select js|", catalog(DEFAULT_CATALOG, "postgres"))
      expectIncludes(result, ["jsonb_agg", "jsonb_build_object"])
    })

    test("offers sqlite-specific functions", () => {
      const result = complete("select ifn|", catalog(DEFAULT_CATALOG, "sqlite"))
      expectIncludes(result, ["ifnull"])
      expectExcludes(result, ["jsonb_build_object"])
    })

    test("offers duckdb-specific functions", () => {
      const result = complete("select date_d|", catalog(DEFAULT_CATALOG, "duckdb"))
      expectIncludes(result, ["date_diff"])
    })
  })

  describe("provider cache", () => {
    test("rebuilds schema index when introspection references change with same node counts", () => {
      let state = catalog()
      const provider = createSqlAutocompleteProvider({
        getState: () => state,
      })

      const first = withCursor("select * from users where em|")
      expectIncludes(
        provider.getCompletions({ text: first.text, cursor: first.cursor }),
        ["email"],
      )

      state = catalog({
        public: {
          users: ["id", "email_address", "created_at"],
          orders: ["id", "user_id", "status"],
        },
        analytics: {
          books: ["id", "title"],
        },
      })

      const second = withCursor("select * from users where email_a|")
      expectIncludes(
        provider.getCompletions({ text: second.text, cursor: second.cursor }),
        ["email_address"],
      )
    })
  })
})
