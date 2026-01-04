import { describe, expect, test } from "bun:test";
import { buildLineStarts } from "./buffer-model";
import { collectSqlStatements, type SqlStatement } from "./sql-statement-detector";

type SpanSummary = Pick<SqlStatement, "startLine" | "endLine">;
type CollectFixture = {
  name: string;
  sql: string;
  expected: SpanSummary[];
};

const collectFixtures: CollectFixture[] = [
  {
    name: "Leading comment before SQL still yields SQL span",
    sql: "-- comment\nSELECT 1;\n",
    expected: [{ startLine: 1, endLine: 1 }],
  },
  {
    name: "Block comment before SQL still yields SQL span",
    sql: "/* mid; */\nSELECT 2;\n",
    expected: [{ startLine: 1, endLine: 1 }],
  },
  {
    name: "Leading semicolon is ignored when statement follows",
    sql: "; \nSELECT 1;\n",
    expected: [{ startLine: 1, endLine: 1 }],
  },
  {
    name: "Block comment with semicolon before SQL still yields SQL span",
    sql: "/* ; */\nSELECT 1;\n",
    expected: [{ startLine: 1, endLine: 1 }],
  },
  {
    name: "Whitespace gap still yields separate SQL spans",
    sql: "SELECT 1;\n\n  \nSELECT 2;\n",
    expected: [
      { startLine: 0, endLine: 0 },
      { startLine: 3, endLine: 3 },
    ],
  },
  {
    name: "Multiple statements without semicolons are split by leading keywords",
    sql: "SELECT * FROM books\nSELECT * FROM authors",
    expected: [
      { startLine: 0, endLine: 0 },
      { startLine: 1, endLine: 1 },
    ],
  },
  {
    name: "Non-SQL leading token is dropped",
    sql: "elect 1;",
    expected: [],
  },
  {
    name: "Comment-only buffer returns nothing",
    sql: "-- hi\n/* test */\n",
    expected: [],
  },
  {
    name: "Detects all configured starters case-insensitively",
    sql: [
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
    expected: [
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
  },
  {
    name: "Splits multi-line statements on new starters without semicolons",
    sql: "CREATE TABLE a (id int)\nDROP TABLE a",
    expected: [
      { startLine: 0, endLine: 0 },
      { startLine: 1, endLine: 1 },
    ],
  },
  {
    name: "Detects all configured starters case-insensitively without semicolons",
    sql: [
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
    expected: [
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
  },
  {
    name: "Flush-left keyword starts a new statement",
    sql: "SELECT 1\nINSERT INTO t VALUES (2)",
    expected: [
      { startLine: 0, endLine: 0 },
      { startLine: 1, endLine: 1 },
    ],
  },
  {
    name: "Indented keyword does not start new statement",
    sql: "SELECT 1\n  INSERT INTO t VALUES (2)",
    expected: [{ startLine: 0, endLine: 1 }],
  },
  {
    name: "WITH CTE stays in one span across newlines",
    sql: "WITH cte AS (\n  SELECT 1\n)\nSELECT * FROM cte;\n",
    expected: [{ startLine: 0, endLine: 3 }],
  },
  {
    name: "Transaction control statements each parsed separately",
    sql: "BEGIN;\nCOMMIT;\nROLLBACK;\n",
    expected: [
      { startLine: 0, endLine: 0 },
      { startLine: 1, endLine: 1 },
      { startLine: 2, endLine: 2 },
    ],
  },
  {
    name: "Keyword-like tokens in complete block comment are ignored",
    sql: "/* SELECT 1 */",
    expected: [],
  },
  {
    name: "Unterminated block comment suppresses detection",
    sql: "/* SELECT 1",
    expected: [],
  },
];

describe("collectSqlStatements", () => {
  for (const { name, sql, expected } of collectFixtures) {
    test(name, () => {
      const lineStarts = buildLineStarts(sql);
      const spans = collectSqlStatements(sql, lineStarts).map((span) => ({
        startLine: span.startLine,
        endLine: span.endLine,
      }));
      expect(spans).toEqual(expected);
    });
  }
});
