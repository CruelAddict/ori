import { describe, expect, test } from "bun:test"
import { type Node, NodeType } from "@adapters/ori/client"
import { docCharOffset } from "@ui/components/buffer/buffer-model/coords"
import { buildLineStarts } from "@utils/line-offsets"
import { resolveSqlDialect } from "./sql-autocomplete/dialect"
import { createSqlAutocompleteProvider } from "./sql-autocomplete/provider"
import { getCurrentSqlStatement } from "./sql-autocomplete/sql-context"
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

    test("stays closed after a completed top-level SELECT keyword", () => {
      expect(
        complete(
          "select|",
          catalog({
            public: { selectables: ["id"], users: ["id", "email", "created_at"] },
            analytics: { books: ["id"] },
          }),
        ),
      ).toBeUndefined()
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

    test("stays closed after FROM newline without a typed prefix", () => {
      expect(complete("select * from\n|")).toBeUndefined()
    })

    test("stays closed after JOIN newline without a typed prefix", () => {
      expect(complete("select * from users join\n|")).toBeUndefined()
    })

    test("stays closed after INSERT space", () => {
      expect(complete("insert |")).toBeUndefined()
    })
  })

  describe("relations", () => {
    test("suggests relations in FROM clause", () => {
      const result = complete("select * from us|")
      expectIncludes(result, ["users"])
      expectExcludes(result, ["email"])
      expect(replaceText("select * from us|", result)).toBe("us")
    })

    test("replaces the full quoted top-level prefix for quoted relations", () => {
      const sql = 'select * from "us|'
      const result = complete(sql, catalog({ public: { "user-profile": ["id", "email"] } }))

      expectIncludes(result, ["user-profile"])
      expect(replaceText(sql, result)).toBe('"us')
      expect(result?.items.find((item) => item.label === "user-profile")?.insertText).toBe('"user-profile"')
    })

    test("suggests relations with a keyword-shaped prefix only in FROM clause", () => {
      const result = complete(
        "select * from sele|",
        catalog({
          public: { selectables: ["id"], users: ["id", "email", "created_at"] },
          analytics: { books: ["id"] },
        }),
      )
      expectIncludes(result, ["selectables"])
    })

    test("does not suggest an exact relation match as a no-op completion", () => {
      const result = complete("select * from users|")
      expectExcludes(result, ["users"])
    })

    test("waits for a second character before suggesting follow-up keywords after relations", () => {
      expect(complete("select * from users w|")).toBeUndefined()
    })

    test("matches trigger-case from the last keyword on lower-case lookback", () => {
      expectOnly(complete("select * from users wh|"), ["where"])
    })

    test("matches trigger-case from the last keyword on upper-case lookback", () => {
      expectOnly(complete("SELECT * FROM users WH|"), ["WHERE"])
    })

    test("stays closed while typing a one-letter join alias", () => {
      expect(complete("select * from users join orders o|")).toBeUndefined()
    })

    test("stays closed after AS on the same line", () => {
      expect(complete("select * from users forecast_rollup as|")).toBeUndefined()
      expect(complete("select * from users forecast_rollup as a|")).toBeUndefined()
    })

    test("resets alias suppression after a newline", () => {
      expectOnly(complete("select * from users as\nwh|"), ["where"])
    })

    test("stays closed after a completed ON predicate and trailing space", () => {
      expect(
        complete(
          "select * from authors a join books b on a.id = b.author_id |",
          catalog({ public: { authors: ["id", "name"], books: ["id", "author_id", "title"] } }),
        ),
      ).toBeUndefined()
    })

    test("suggests WHERE before WHEN after a completed ON predicate", () => {
      const result = complete(
        "select * from authors a join books b on a.id = b.author_id w|",
        catalog({ public: { authors: ["id", "name"], books: ["id", "author_id", "title"] } }),
      )
      expect(labels(result)[0]).toBe("where")
    })

    test("does not suggest WHERE before the ON predicate is complete", () => {
      const result = complete(
        "select * from authors a join books b on a.id = w|",
        catalog({ public: { authors: ["id", "name"], books: ["id", "author_id", "title"] } }),
      )
      expectExcludes(result, ["where"])
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

    test("suggests alias columns for comma joins", () => {
      const result = complete("select o.| from users u, orders o")
      expectIncludes(result, ["id", "user_id", "status"])
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
      expect(result?.items.find((item) => item.label === "email")?.meta).toBe("text")
      expect(result?.items.find((item) => item.label === "email")?.description).toBe("users")
    })

    test("stays closed after a completed WHERE keyword", () => {
      expect(
        complete(
          "select * from authors where|",
          catalog({ public: { authors: ["id", "thirteen_month_weighted_average", "allocations_ad_hoc_tracking_"] } }),
        ),
      ).toBeUndefined()
    })

    test("qualifies ambiguous columns in joins", () => {
      const result = complete("select i| from users u join orders o on u.id = o.user_id")
      expectIncludes(result, ["u.id", "o.id"])
      expectExcludes(result, ["id"])
    })

    test("keeps unambiguous columns unqualified in joins", () => {
      const result = complete("select em| from users u join orders o on u.id = o.user_id")
      expectIncludes(result, ["email"])
      expectExcludes(result, ["u.email"])
      expect(result?.items.find((item) => item.label === "email")?.insertText).toBe("email")
    })

    test("suggests aliases before qualified column completion", () => {
      const result = complete("select ma| from users u join users manager on u.id = manager.id")
      expectIncludes(result, ["manager"])
      expectExcludes(result, ["manager.id"])
    })

    test("qualifies ambiguous columns with table names without aliases", () => {
      const result = complete("select i| from users join orders on users.id = orders.user_id")
      expectIncludes(result, ["users.id", "orders.id"])
      expectExcludes(result, ["id"])
    })

    test("keeps both aliases for ambiguous self-join columns", () => {
      const result = complete("select i| from users u join users manager on u.id = manager.id")
      expectIncludes(result, ["u.id", "manager.id"])
      expectExcludes(result, ["id"])
    })

    test("keeps WHERE suggestions inside parentheses without a nested query", () => {
      const result = complete("select * from users where (em|)")
      expectIncludes(result, ["email"])
      expectExcludes(result, ["users"])
    })

    test("suggests inner query columns inside a nested WHERE clause once typing starts", () => {
      const result = complete("select * from users where exists (select 1 from orders where u|)")
      expectIncludes(result, ["user_id"])
      expectExcludes(result, ["users", "orders"])
    })

    test("suggests outer alias columns inside correlated subqueries", () => {
      const result = complete("select * from users u where exists (select 1 from orders o where o.user_id = u.|)")
      expectIncludes(result, ["id", "email", "created_at"])
    })

    test("does not leak aliases declared after a derived subquery", () => {
      const result = complete("select * from (select u.|) s join users u on true")
      expect(result).toBeUndefined()
    })

    test("stays closed on an exact scoped alias token until dot completion starts", () => {
      expect(
        complete(
          "with allocation_rollup as (select id as allocation_id from users), forecast_rollup as (select id as forecast_id from orders) select * from allocation_rollup ar join forecast_rollup fr on ar.allocation_id = fr|",
        ),
      ).toBeUndefined()
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

    test("suggests cte columns inferred from an aliased star projection", () => {
      const result = complete("with recent as (select u.* from users u) select recent.| from recent")
      expectIncludes(result, ["id", "email", "created_at"])
    })

    test("suggests derived table columns inferred from an aliased star projection", () => {
      const result = complete("select sub.| from (select u.* from users u) sub")
      expectIncludes(result, ["id", "email", "created_at"])
    })

    test("suggests derived table aliases in select expressions", () => {
      const result = complete("select s| from (select email from users) sub")
      expectIncludes(result, ["sub"])
    })

    test("shows a clean detail for derived tables", () => {
      const result = complete("select s| from (select email from users) sub")
      expect(result?.items.find((item) => item.label === "sub")?.description).toBe("subquery")
    })

    test("suggests quoted alias columns and preserves quoted insert text", () => {
      const result = complete(
        'select "u".| from users as "u"',
        catalog({ public: { users: ["id", "EmailAddress"] }, analytics: { books: ["id", "title"] } }),
      )
      expectIncludes(result, ["id", "EmailAddress"])
      expect(result?.items.find((item) => item.label === "EmailAddress")?.insertText).toBe('"EmailAddress"')
    })

    test("replaces the full quoted member prefix when completing a quoted column", () => {
      const sql = 'select "u"."E| from users as "u"'
      const result = complete(sql, catalog({ public: { users: ["id", "EmailAddress"] } }))
      expectIncludes(result, ["EmailAddress"])
      expect(replaceText(sql, result)).toBe('"E')
      expect(result?.items.find((item) => item.label === "EmailAddress")?.insertText).toBe('"EmailAddress"')
    })

    test("resolves 3-part relation names for column suggestions", () => {
      const result = complete("select em| from warehouse.public.users")
      expectIncludes(result, ["email"])
      expectExcludes(result, ["status"])
    })

    test("prefers default schema relations for unqualified names", () => {
      const result = complete(
        "select em| from users",
        catalog({ public: { users: ["id", "email"] }, analytics: { users: ["id", "event_name"] } }),
      )
      expectIncludes(result, ["email"])
      expectExcludes(result, ["event_name"])
    })

    test("suggests select-list aliases in ORDER BY", () => {
      const result = complete("select email as user_email from users order by user_|")
      expectIncludes(result, ["user_email"])
    })

    test("prefers FROM after SELECT star prefix", () => {
      expectOnly(complete("select * fr|"), ["from"])
    })

    test("prefers FROM after a select-list prefix", () => {
      expectOnly(complete("select fro|"), ["from"])
    })

    test("prefers upper-case FROM after an upper-case select-list prefix", () => {
      expectOnly(complete("SELECT FR|"), ["FROM"])
    })

    test("does not prefer FROM on a single-letter select-list prefix", () => {
      expectExcludes(complete("select f|"), ["from"])
    })

    test("prefers frequent SELECT over shorter SET for a shared prefix", () => {
      const result = complete("se|")
      const current = labels(result)
      expect(current.indexOf("select")).toBeLessThan(current.indexOf("set"))
    })

    test("does not fuzzy match keywords", () => {
      expectExcludes(complete("slt|"), ["select"])
    })

    test("prefers frequent WHERE over WHEN for a shared prefix", () => {
      const result = complete("wh|")
      const current = labels(result)
      expect(current.indexOf("where")).toBeLessThan(current.indexOf("when"))
    })

    test("does not suggest multi-word operators from trailing word fragments", () => {
      const result = complete("select * from users where email is not n|")
      expectExcludes(result, ["is null", "is not null"])
    })

    test("stays closed after a completed expression keyword", () => {
      expect(complete("select null|")).toBeUndefined()
    })

    test("stays closed after a completed IS NOT NULL predicate", () => {
      expect(
        complete("select * from authors where email is not null|", {
          ...catalog({ public: { authors: ["id", "email", "name"] } }),
        }),
      ).toBeUndefined()
    })

    test("suggests NULLIF after typing beyond the NULL keyword", () => {
      const result = complete("select nulli|")
      expectIncludes(result, ["nullif"])
    })

    test("suggests UNION after a select expression", () => {
      const result = complete("select 1 uni|")
      expectIncludes(result, ["union", "union all"])
    })

    test("formats functions in lower-case for lower-case prefixes", () => {
      const result = complete("select co|")
      expectIncludes(result, ["count", "coalesce"])
    })

    test("places function autocomplete cursor inside parentheses", () => {
      const result = complete("select pri|", catalog(DEFAULT_CATALOG, "sqlite"))
      const item = result?.items.find((item) => item.label === "printf")

      expect(item?.insertText).toBe("printf()")
      expect(item?.cursorOffset).toBe("printf(".length)
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

    test("stays closed after the insert target relation without a typed prefix", () => {
      expect(complete("insert into users |")).toBeUndefined()
    })

    test("suggests insert follow-up keywords once typing starts", () => {
      const result = complete("insert into users v|")
      expectIncludes(result, ["values"])
      expectExcludes(result, ["users"])
    })

    test("stays closed at the end of the insert target relation without whitespace", () => {
      expect(complete("insert into users|")).toBeUndefined()
    })

    test("does not fall back to relation names after an insert target relation", () => {
      expect(complete("insert into users u|")).toBeUndefined()
    })

    test("stays closed at the start of the insert target column list", () => {
      expect(complete("insert into users (|")).toBeUndefined()
    })

    test("suggests insert target columns once typing starts", () => {
      const result = complete("insert into users (e|")
      expectIncludes(result, ["email"])
      expectExcludes(result, ["users", "id"])
    })

    test("skips already listed insert target columns when typing the next one", () => {
      const result = complete("insert into users (id, e|")
      expectIncludes(result, ["email"])
      expectExcludes(result, ["id"])
    })

    test("suggests SET after UPDATE relation once two characters are typed", () => {
      expect(complete("update users s|")).toBeUndefined()
      expectOnly(complete("update users se|"), ["set"])
    })

    test("stays closed after DELETE target relation without a typed prefix", () => {
      expect(complete("delete from users |")).toBeUndefined()
    })

    test("limits DELETE follow-up keywords to delete-specific options once typing starts", () => {
      expectOnly(complete("delete from users w|"), ["where"])
    })

    test("suggests GROUP BY after a completed WHERE expression", () => {
      const result = complete(
        "select * from authors a join books b on a.id = b.author_id where a.email is not null grou|",
        {
          ...catalog({ public: { authors: ["id", "email"], books: ["id", "author_id", "title"] } }),
        },
      )
      expectIncludes(result, ["group by"])
    })

    test("suggests only BY after the second word of GROUP BY starts", () => {
      expectOnly(
        complete("select * from authors a join books b on a.id = b.author_id where a.email is not null group b|", {
          ...catalog({ public: { authors: ["id", "email"], books: ["id", "author_id", "title"] } }),
        }),
        ["by"],
      )
    })

    test("suggests LIMIT after grouped expressions", () => {
      const result = complete(
        "with recent as (select email iii from authors) select iii from recent group by iii li|",
        {
          ...catalog({ public: { authors: ["id", "email", "name"] } }),
        },
      )
      expectIncludes(result, ["limit"])
      expectExcludes(result, ["nullif"])
    })

    test("stays closed after LIMIT when the next token must be numeric", () => {
      expect(
        complete("with asd as (select email as www from authors) select www from asd limit |", {
          ...catalog({ public: { authors: ["id", "email", "name"] } }),
        }),
      ).toBeUndefined()
    })

    test("stays closed after a LIMIT value", () => {
      expect(
        complete("with asd as (select email as www from authors) select www from asd limit 10|", {
          ...catalog({ public: { authors: ["id", "email", "name"] } }),
        }),
      ).toBeUndefined()
    })

    test("stays closed after a completed FROM relation without a typed prefix", () => {
      expect(
        complete("with asd as (select email as www from authors) select www from asd |", {
          ...catalog({ public: { authors: ["id", "email", "name"] } }),
        }),
      ).toBeUndefined()
    })

    test("stays closed after a completed WHERE expression without a typed prefix", () => {
      expect(
        complete("select * from authors where email is not null |", {
          ...catalog({ public: { authors: ["id", "email", "name"] } }),
        }),
      ).toBeUndefined()
    })
  })

  describe("ctes and temp tables", () => {
    test("suggests RECURSIVE after WITH", () => {
      expectIncludes(complete("with rec|"), ["recursive"])
      expectIncludes(complete("WITH REC|"), ["RECURSIVE"])
    })

    test("suggests cte names inside the current statement", () => {
      const result = complete("with recent as (select * from users) select * from re|")
      expectIncludes(result, ["recent"])
    })

    test("supports materialized ctes", () => {
      const result = complete("with recent as materialized (select email from users) select em| from recent")
      expectIncludes(result, ["email"])
    })

    test("suggests recursive cte name and header columns inside its body", () => {
      const result = complete(
        "with recursive seq(nnnn) as (select 1 union all select nnnn + 1 from se| where nnnn < 1000) select * from seq",
      )
      expectIncludes(result, ["seq"])

      const columnResult = complete(
        "with recursive seq(nnnn) as (select 1 union all select nnn| + 1 from seq where nnnn < 1000) select * from seq",
      )
      expectIncludes(columnResult, ["nnnn"])
    })

    test("suggests SELECT after UNION ALL inside recursive cte body", () => {
      const result = complete(
        "with recursive seq(nnnn) as (select 1 union all se| nnnn + 1 from seq where nnnn < 1000) select * from seq",
      )

      expectIncludes(result, ["select"])
    })

    test("suggests recursive cte header columns in the outer query", () => {
      const result = complete(
        "with recursive seq(nnnn) as (select 1 union all select nnnn + 1 from seq where nnnn < 1000) select nnn| from seq",
      )
      expectIncludes(result, ["nnnn"])
    })

    test("does not leak ctes from previous statements", () => {
      const result = complete("with recent as (select * from users) select * from recent; select * from re|")
      expectExcludes(result, ["recent"])
    })

    test("does not leak ctes from a sibling nested subquery", () => {
      const result = complete(
        "select * from users where exists (with recent as (select * from orders) select * from recent) and exists (select * from re|)",
      )
      expectExcludes(result, ["recent"])
    })

    test("keeps flush-left with queries in the same statement", () => {
      const result = complete("WITH recent AS (\nSELECT email FROM users\n)\nSELECT em| FROM recent")
      expectIncludes(result, ["email"])
    })

    test("suggests previous temp tables in FROM clause", () => {
      const result = complete("create temp table temp_users as select * from users; select * from temp_|")
      expectIncludes(result, ["temp_users"])
      expect(result?.items.find((item) => item.label === "temp_users")?.description).toBe("temp table")
    })

    test("does not look ahead for temp tables", () => {
      const result = complete("select * from temp_|; create temp table temp_users as select * from users")
      expectExcludes(result, ["temp_users"])
    })
  })

  describe("reported regressions", () => {
    test("suggests WHERE after a completed USING join clause", () => {
      expectOnly(complete("select * from users join orders using (id) w|"), ["where"])
    })

    test("uses explicit derived table column alias lists", () => {
      const result = complete("select s.u| from (select email, id from users) as s(user_email, user_id)")
      expectIncludes(result, ["user_email", "user_id"])
      expectExcludes(result, ["email", "id"])
    })

    test("stays closed on an empty EXISTS body", () => {
      expect(complete("select * from users where exists (|")).toBeUndefined()
      expect(complete("select * from users where exists (\n|")).toBeUndefined()
      expect(complete("select * from users where exists (\n\n|")).toBeUndefined()
    })

    test("opens with SELECT and WITH inside EXISTS once typing starts", () => {
      expectIncludes(complete("select * from users where exists (se|"), ["select"])
      expectIncludes(complete("select * from users where exists (\nse|"), ["select"])
      expectIncludes(complete("select * from users where exists (SE|"), ["SELECT"])
      expectIncludes(complete("select * from users where exists (wi|"), ["with"])
    })

    test("keeps completed predicates on keyword follow-ups", () => {
      const result = complete("select * from users u where exists (select 1 from orders o where o.user_id = u.id) or|")
      expectIncludes(result, ["order by"])
      expectExcludes(result, ["users", "orders", "id", "user_id"])
    })
  })

  describe("statement isolation", () => {
    test("does not use previous statement relations for column suggestions", () => {
      const result = complete("select * from users; select em|")
      expectExcludes(result, ["email"])
      expect(result).toBeUndefined()
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

    test("does not fuzzy match functions", () => {
      const result = complete("select mn|")
      expectExcludes(result, ["min"])
    })

    test("offers duckdb-specific functions", () => {
      const result = complete("select date_d|", catalog(DEFAULT_CATALOG, "duckdb"))
      expectIncludes(result, ["date_diff"])
    })
  })

  describe("provider cache", () => {
    test("rebuilds schema index when introspection references change with same node counts", async () => {
      let state = catalog()
      const provider = createSqlAutocompleteProvider({
        getState: () => state,
      })

      const first = withCursor("select * from users where em|")
      expectIncludes(
        await provider.getCompletions({
          text: first.text,
          cursor: docCharOffset(first.cursor),
          signal: new AbortController().signal,
        }),
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
        await provider.getCompletions({
          text: second.text,
          cursor: docCharOffset(second.cursor),
          signal: new AbortController().signal,
        }),
        ["email_address"],
      )
    })
  })
})
