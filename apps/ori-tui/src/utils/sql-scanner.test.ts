import { describe, expect, test } from "bun:test"
import { scanSql } from "./sql-scanner"

describe("scanSql", () => {
  test("ignores keywords and statement boundaries in quoted and commented text", () => {
    const scan = scanSql(`SELECT 'LIMIT; -- ignored', "OFFSET", $$FOR;$$ -- INTO\nFROM books; /* SELECT */`)

    expect(scan.firstKeyword).toBe("select")
    expect(scan.topLevelKeywords).toEqual(new Set(["select", "from", "books"]))
    expect(scan.hasMultipleStatements).toBe(false)
    expect(scan.terminatorIndex).toBeDefined()
  })

  test("tracks nested tokens and multiple top-level statements", () => {
    const scan = scanSql("SELECT (SELECT 1;); SELECT 2")

    expect(scan.hasMultipleStatements).toBe(true)
    expect(scan.tokens.filter((token) => token.kind === "semicolon").map((token) => token.depth)).toEqual([1, 0])
  })

  test("treats brackets as array and list syntax", () => {
    const scan = scanSql("SELECT ARRAY['right]bracket']; SELECT ['right]bracket'];")

    expect(scan.hasMultipleStatements).toBe(true)
    expect(scan.tokens.filter((token) => token.kind === "semicolon").map((token) => token.depth)).toEqual([0, 0])
  })

  test("recovers statement depth after a malformed statement terminator", () => {
    const scan = scanSql("SELECT (1;\nSELECT 2")

    expect(scan.hasMultipleStatements).toBe(true)
    expect(scan.tokens.find((token) => token.value === "select" && token.start > 10)?.depth).toBe(0)
  })

  test("handles dollar tags without allocating a suffix for every dollar", () => {
    const scan = scanSql(`${"$1 ".repeat(10000)}SELECT $tag$LIMIT;$tag$;`)

    expect(scan.firstKeyword).toBe("select")
    expect(scan.hasMultipleStatements).toBe(false)
  })
})
