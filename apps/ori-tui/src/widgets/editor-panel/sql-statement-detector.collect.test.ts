import { describe, expect, test } from "vitest"
import { buildLineStarts } from "./buffer-model"
import { collectSqlStatements, type SqlStatement } from "./sql-statement-detector"

type SpanSummary = Pick<SqlStatement, "startLine" | "endLine">

function runTest(sql: string, expected: SpanSummary[]) {
  const lineStarts = buildLineStarts(sql)
  const spans = collectSqlStatements(sql, lineStarts).map((span) => ({
    startLine: span.startLine,
    endLine: span.endLine,
  }))
  expect(spans).toEqual(expected)
}

describe("collectSqlStatements", () => {
  test("Leading comment before SQL still yields SQL span", () =>
    runTest("-- comment\nSELECT 1;\n", [{ startLine: 1, endLine: 1 }]))

  test("Block comment before SQL still yields SQL span", () =>
    runTest("/* mid; */\nSELECT 2;\n", [{ startLine: 1, endLine: 1 }]))

  test("Leading semicolon is ignored when statement follows", () =>
    runTest("; \nSELECT 1;\n", [{ startLine: 1, endLine: 1 }]))

  test("Block comment with semicolon before SQL still yields SQL span", () =>
    runTest("/* ; */\nSELECT 1;\n", [{ startLine: 1, endLine: 1 }]))

  test("Whitespace gap still yields separate SQL spans", () =>
    runTest("SELECT 1;\n\n  \nSELECT 2;\n", [
      { startLine: 0, endLine: 0 },
      { startLine: 3, endLine: 3 },
    ]))

  test("Multiple statements without semicolons are split by leading keywords", () =>
    runTest("SELECT * FROM books\nSELECT * FROM authors", [
      { startLine: 0, endLine: 0 },
      { startLine: 1, endLine: 1 },
    ]))

  test("Non-SQL leading token is dropped", () => runTest("elect 1;", []))

  test("Comment-only buffer returns nothing", () => runTest("-- hi\n/* test */\n", []))

  test("Detects all configured starters case-insensitively", () =>
    runTest(
      [
        "WITH cte AS (SELECT 1)",
        "SELECT * FROM cte;",
        "SELECT 42;",
        "INSERT INTO t VALUES (1);",
        "Update t set a=1;",
        "DELETE FROM t;",
        "CREATE TABLE t(a int);",
        "ALTER TABLE t ADD b int;",
        "DROP TABLE t;",
        "TRUNCATE table t;",
        "BEGIN;",
        "COMMIT;",
        "ROLLBACK;",
        "GRANT SELECT ON t TO u;",
        "REVOKE SELECT ON t FROM u;",
        "CALL do_something();",
        "EXPLAIN SELECT 1;",
        "ANALYZE SELECT 1;",
        "SHOW search_path;",
        "DESCRIBE t;",
      ].join("\n"),
      [
        { startLine: 0, endLine: 1 },
        { startLine: 2, endLine: 2 },
        { startLine: 3, endLine: 3 },
        { startLine: 4, endLine: 4 },
        { startLine: 5, endLine: 5 },
        { startLine: 6, endLine: 6 },
        { startLine: 7, endLine: 7 },
        { startLine: 8, endLine: 8 },
        { startLine: 9, endLine: 9 },
        { startLine: 10, endLine: 10 },
        { startLine: 11, endLine: 11 },
        { startLine: 12, endLine: 12 },
        { startLine: 13, endLine: 13 },
        { startLine: 14, endLine: 14 },
        { startLine: 15, endLine: 15 },
        { startLine: 16, endLine: 16 },
        { startLine: 17, endLine: 17 },
        { startLine: 18, endLine: 18 },
        { startLine: 19, endLine: 19 },
      ],
    ))

  test("Splits multi-line statements on new starters without semicolons", () =>
    runTest("CREATE TABLE a (id int)\nDROP TABLE a", [
      { startLine: 0, endLine: 0 },
      { startLine: 1, endLine: 1 },
    ]))

  test("Detects all configured starters case-insensitively without semicolons", () =>
    runTest(
      [
        "WITH cte AS (SELECT 1)",
        "SELECT * FROM cte",
        "SELECT 42",
        "INSERT INTO t VALUES (1)",
        "Update t set a=1",
        "DELETE FROM t",
        "CREATE TABLE t(a int)",
        "ALTER TABLE t ADD b int",
        "DROP TABLE t",
        "TRUNCATE table t",
        "BEGIN",
        "COMMIT",
        "ROLLBACK",
        "GRANT SELECT ON t TO u",
        "REVOKE SELECT ON t FROM u",
        "CALL do_something()",
        "EXPLAIN SELECT 1",
        "ANALYZE SELECT 1",
        "SHOW search_path",
        "WITH cte AS (SELECT 1)",
        "SELECT * FROM cte",
        "DESCRIBE t",
      ].join("\n"),
      [
        { startLine: 0, endLine: 1 },
        { startLine: 2, endLine: 2 },
        { startLine: 3, endLine: 3 },
        { startLine: 4, endLine: 4 },
        { startLine: 5, endLine: 5 },
        { startLine: 6, endLine: 6 },
        { startLine: 7, endLine: 7 },
        { startLine: 8, endLine: 8 },
        { startLine: 9, endLine: 9 },
        { startLine: 10, endLine: 10 },
        { startLine: 11, endLine: 11 },
        { startLine: 12, endLine: 12 },
        { startLine: 13, endLine: 13 },
        { startLine: 14, endLine: 14 },
        { startLine: 15, endLine: 15 },
        { startLine: 16, endLine: 16 },
        { startLine: 17, endLine: 17 },
        { startLine: 18, endLine: 18 },
        { startLine: 19, endLine: 20 },
        { startLine: 21, endLine: 21 },
      ],
    ))

  test("Flush-left keyword starts a new statement", () =>
    runTest("SELECT 1\nINSERT INTO t VALUES (2)", [
      { startLine: 0, endLine: 0 },
      { startLine: 1, endLine: 1 },
    ]))

  test("Indented keyword does not start new statement", () =>
    runTest("SELECT 1\n  INSERT INTO t VALUES (2)", [{ startLine: 0, endLine: 1 }]))

  test("WITH CTE stays in one span across newlines", () =>
    runTest("WITH cte AS (\n  SELECT 1\n)\nSELECT * FROM cte;\n", [{ startLine: 0, endLine: 3 }]))

  test("Transaction control statements each parsed separately", () =>
    runTest("BEGIN;\nCOMMIT;\nROLLBACK;\n", [
      { startLine: 0, endLine: 0 },
      { startLine: 1, endLine: 1 },
      { startLine: 2, endLine: 2 },
    ]))

  test("Keyword-like tokens in complete block comment are ignored", () => runTest("/* SELECT 1 */", []))

  test("Unterminated block comment suppresses detection", () => runTest("/* SELECT 1", []))
})
