import { describe, expect, test } from "bun:test"
import type { QueryJob } from "@usecase/query/usecase"
import type { ResultSourcePage } from "@usecase/result-source/usecase"
import { buildResultPagination } from "./result-pagination-model"

describe("buildResultPagination", () => {
  test("shows an upper bound for an empty out-of-range page", () => {
    const job: QueryJob = {
      jobId: "job",
      resourceName: "local",
      query: "SELECT * FROM books",
      status: "success",
      startedAt: 0,
      result: { columns: [], rows: [], rowCount: 0, truncated: false },
    }
    const page: ResultSourcePage = {
      pageSize: 500,
      offset: 1000,
      totalRows: 1001,
      isTotalRowsExact: false,
    }

    expect(buildResultPagination(job, page, false)).toBe("- / ≤1000")
  })
})
