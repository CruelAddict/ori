import { describe, expect, test } from "bun:test"
import { buildLineStarts } from "@utils/line-offsets"
import {
  analyzeSqlDocument,
  collectSqlQueries,
  collectSqlStatements,
  resolveSqlQueryAtOffset,
} from "./sql-statement-detector"

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

describe("sql statement detector", () => {
  test("collects logical queries without requiring known starter keywords", () => {
    const sql = "selct 1;\n\nSELECT 2;\n-- comment only\n"
    const queries = collectSqlQueries(sql, buildLineStarts(sql)).map((query) => sql.slice(query.start, query.end))

    expect(queries).toEqual(["selct 1;", "SELECT 2;"])
  })

  test("resolves the query under cursor", () => {
    const sql = withCursor("SELECT 1;\nSELECT |2;")
    const resolution = resolveSqlQueryAtOffset(sql.text, buildLineStarts(sql.text), sql.cursor)

    expect(resolution.kind).toBe("query")
    if (resolution.kind !== "query") {
      return
    }
    expect(sql.text.slice(resolution.query.start, resolution.query.end)).toBe("SELECT 2;")
    expect(resolution.query.startLine).toBe(1)
    expect(resolution.query.endLine).toBe(1)
  })

  test("resolves the only query on the current line even when the cursor is after its semicolon", () => {
    const sql = withCursor(
      "SELECT * FROM authors;|\nWITH asd AS (SELECT email iii FROM authors)\nSELECT iii FROM asd\nGROUP BY iii\nLIMIT 10;",
    )
    const resolution = resolveSqlQueryAtOffset(sql.text, buildLineStarts(sql.text), sql.cursor)

    expect(resolution.kind).toBe("query")
    if (resolution.kind !== "query") {
      return
    }
    expect(sql.text.slice(resolution.query.start, resolution.query.end)).toBe("SELECT * FROM authors;")
    expect(resolution.query.startLine).toBe(0)
    expect(resolution.query.endLine).toBe(0)
  })

  test("returns none when the current line is outside every query", () => {
    const sql = withCursor("SELECT 1;\n|\nSELECT 2;")
    const resolution = resolveSqlQueryAtOffset(sql.text, buildLineStarts(sql.text), sql.cursor)

    expect(resolution).toEqual({ kind: "none" })
  })

  test("returns ambiguous when two queries share the cursor line", () => {
    const sql = withCursor("SELECT 1; SEL|ECT 2;\nSELECT 3;")
    const resolution = resolveSqlQueryAtOffset(sql.text, buildLineStarts(sql.text), sql.cursor)

    expect(resolution.kind).toBe("ambiguous")
    if (resolution.kind !== "ambiguous") {
      return
    }
    expect(resolution.queries.map((query) => sql.text.slice(query.start, query.end))).toEqual([
      "SELECT 1;",
      "SELECT 2;",
    ])
  })

  test("returns ambiguous anywhere on a line that contains multiple queries", () => {
    const sql = withCursor("SELECT 1; SELECT 2|;\nSELECT 3;")
    const resolution = resolveSqlQueryAtOffset(sql.text, buildLineStarts(sql.text), sql.cursor)

    expect(resolution.kind).toBe("ambiguous")
    if (resolution.kind !== "ambiguous") {
      return
    }
    expect(resolution.queries.map((query) => sql.text.slice(query.start, query.end))).toEqual([
      "SELECT 1;",
      "SELECT 2;",
    ])
  })

  test("treats GO lines as gaps between executable queries", () => {
    const sql = "SELECT 1;\nGO\nCREATE UNIQUE INDEX idx_users_email ON users(email);"
    const queries = collectSqlQueries(sql, buildLineStarts(sql)).map((query) => sql.slice(query.start, query.end))

    expect(queries).toEqual(["SELECT 1;", "CREATE UNIQUE INDEX idx_users_email ON users(email);"])

    const goLine = withCursor("SELECT 1;\n|GO\nCREATE UNIQUE INDEX idx_users_email ON users(email);")
    expect(resolveSqlQueryAtOffset(goLine.text, buildLineStarts(goLine.text), goLine.cursor)).toEqual({ kind: "none" })

    const createLine = withCursor("SELECT 1;\nGO\nCREATE |UNIQUE INDEX idx_users_email ON users(email);")
    const resolution = resolveSqlQueryAtOffset(createLine.text, buildLineStarts(createLine.text), createLine.cursor)

    expect(resolution.kind).toBe("query")
    if (resolution.kind !== "query") {
      return
    }
    expect(createLine.text.slice(resolution.query.start, resolution.query.end)).toBe(
      "CREATE UNIQUE INDEX idx_users_email ON users(email);",
    )
  })

  test("treats standalone comments between executable queries as gaps", () => {
    const sql = "SELECT 1\n-- note\nSELECT 2"
    const queries = collectSqlQueries(sql, buildLineStarts(sql)).map((query) => sql.slice(query.start, query.end))

    expect(queries).toEqual(["SELECT 1", "SELECT 2"])

    const commentLine = withCursor("SELECT 1\n-- no|te\nSELECT 2")
    expect(resolveSqlQueryAtOffset(commentLine.text, buildLineStarts(commentLine.text), commentLine.cursor)).toEqual({
      kind: "none",
    })

    const analysis = analyzeSqlDocument(sql, buildLineStarts(sql))
    expect(analysis.queryStartLineByLine).toEqual([0, -1, 2])
  })

  test("strict statement collection skips malformed logical spans", () => {
    const sql = "as\nselect * from authors;\nselect * from books limit 10;"
    const parsed = collectSqlStatements(sql, buildLineStarts(sql))
    const statements = parsed.map((query) => sql.slice(query.start, query.end))

    expect(statements).toEqual(["select * from books limit 10;"])
  })

  test("keeps invalid prefix attached to following select for permissive queries", () => {
    const sql = "as\nselect * from authors;\nselect * from books limit 10;"
    const queries = collectSqlQueries(sql, buildLineStarts(sql)).map((query) => sql.slice(query.start, query.end))

    expect(queries).toEqual(["as\nselect * from authors;", "select * from books limit 10;"])
  })

  test("keeps leading comment lines inside strict statement line coverage", () => {
    const sql = "-- note\nselect * from authors;"
    const parsed = collectSqlStatements(sql, buildLineStarts(sql))

    expect(parsed[0]?.startLine).toBe(0)
  })
})
