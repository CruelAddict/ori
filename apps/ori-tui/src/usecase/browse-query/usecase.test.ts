import { describe, expect, test } from "bun:test"
import { buildBrowseQuery } from "./usecase"

describe("buildBrowseQuery", () => {
  test("builds browse SQL from a qualified name", () => {
    const result = buildBrowseQuery({
      getQualifiedName: () => '"public"."authors"',
    })

    expect(result).toEqual({
      query: 'SELECT * FROM "public"."authors" LIMIT 501 OFFSET 0',
      maxRows: 500,
    })
  })

  test("applies window options", () => {
    const result = buildBrowseQuery(
      {
        getQualifiedName: () => '"main"."books"',
      },
      { limit: 20, offset: 40 },
    )

    expect(result).toEqual({
      query: 'SELECT * FROM "main"."books" LIMIT 21 OFFSET 40',
      maxRows: 20,
    })
  })
})
