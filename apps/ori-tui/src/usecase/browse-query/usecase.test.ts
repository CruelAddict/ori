import { describe, expect, test } from "bun:test"
import { buildBrowseQuery } from "./usecase"

describe("buildBrowseQuery", () => {
  test("builds browse SQL from a qualified name", () => {
    const result = buildBrowseQuery({
      getQualifiedName: () => '"public"."authors"',
    })

    expect(result).toBe('SELECT * FROM "public"."authors"')
  })
})
