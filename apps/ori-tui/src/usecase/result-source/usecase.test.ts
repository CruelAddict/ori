import { describe, expect, test } from "bun:test"
import type { QueryExecOptions, QueryResultView } from "@adapters/ori/client"
import type { QueryExecutionOptions, QueryJob, QueryOutcome, QueryTask, QueryUsecase } from "@usecase/query/usecase"
import pino from "pino"
import { buildResultSourceQuery, createResultSourceUC } from "./usecase"

type Execution = {
  jobId: string
  query: string
  options?: QueryExecOptions
}

function createQueryHarness(initialTotalRows = 1205) {
  const executions: Execution[] = []
  let totalRows = initialTotalRows
  let holdCounts = false

  const execute = (query: string, options?: QueryExecOptions, execution?: QueryExecutionOptions): QueryTask => {
    const jobId = `job-${executions.length + 1}`
    const startedAt = Date.now()
    let resolve: (outcome: QueryOutcome) => void = () => {}
    let settled = false
    const done = new Promise<QueryOutcome>((resolvePromise) => {
      resolve = resolvePromise
    })
    const update = (job: QueryJob) => {
      execution?.onUpdate?.(job)
    }
    const finish = (status: QueryOutcome["status"], result?: QueryResultView) => {
      if (settled) {
        return
      }
      settled = true
      const outcome: QueryOutcome = {
        jobId,
        resourceName: "local-sqlite",
        query,
        status,
        startedAt,
        finishedAt: Date.now(),
        result,
      }
      update(outcome)
      resolve(outcome)
    }
    const task: QueryTask = {
      jobId,
      done,
      cancel: () => finish("canceled"),
    }

    executions.push({ jobId, query, options })
    update({ jobId, resourceName: "local-sqlite", query, status: "running", startedAt })
    if (!holdCounts || !query.includes("COUNT(*)")) {
      finish("success", createResult(query, totalRows, options?.maxRows))
    }
    return task
  }

  return {
    query: { execute } satisfies Pick<QueryUsecase, "execute">,
    executions,
    setTotalRows: (value: number) => {
      totalRows = value
    },
    setHoldCounts: (value: boolean) => {
      holdCounts = value
    },
  }
}

function createResult(query: string, totalRows: number, maxRows?: number): QueryResultView {
  if (query.includes("COUNT(*)")) {
    return {
      columns: [{ name: "total_rows", type: "integer" }],
      rows: [[String(totalRows)]],
      rowCount: 1,
      truncated: false,
    }
  }

  const offset = Number(query.match(/OFFSET (\d+)/)?.[1] ?? 0)
  const rowCount = Math.min(maxRows ?? totalRows, Math.max(0, totalRows - offset))
  return {
    columns: [{ name: "id", type: "integer" }],
    rows: Array.from({ length: rowCount }, (_, index) => [String(offset + index + 1)]),
    rowCount,
    truncated: offset + rowCount < totalRows,
  }
}

function createResultSource(query: Pick<QueryUsecase, "execute">) {
  return createResultSourceUC({
    resourceName: "local-sqlite",
    logger: pino({ enabled: false }),
    query,
    getAutoLimitRows: () => 500,
  })
}

describe("buildResultSourceQuery", () => {
  test("adds a page window to simple select queries", () => {
    expect(buildResultSourceQuery('SELECT * FROM "main"."books";', 500)).toEqual({
      query: 'SELECT * FROM "main"."books"\nLIMIT 501 OFFSET 0',
      sourceQuery: 'SELECT * FROM "main"."books"',
      maxRows: 500,
      pagination: { pageSize: 500, offset: 0, totalRows: 501, isTotalRowsExact: false },
    })
  })

  test("adds a page window to PostgreSQL arrays and DuckDB lists", () => {
    expect(buildResultSourceQuery("SELECT ARRAY['right]bracket'];", 500).query).toBe(
      "SELECT ARRAY['right]bracket']\nLIMIT 501 OFFSET 0",
    )
    expect(buildResultSourceQuery("SELECT ['right]bracket'];", 500).query).toBe(
      "SELECT ['right]bracket']\nLIMIT 501 OFFSET 0",
    )
  })

  test("does not auto-limit queries with explicit windows or unsafe modifiers", () => {
    expect(buildResultSourceQuery("SELECT * FROM books WHERE id = 1", 500).pagination).toBeDefined()
    expect(buildResultSourceQuery("SELECT * FROM books LIMIT 10", 500).pagination).toBeUndefined()
    expect(buildResultSourceQuery("SELECT * FROM books OFFSET 10", 500).pagination).toBeUndefined()
    expect(buildResultSourceQuery("WITH books AS (SELECT 1) SELECT * FROM books", 500).pagination).toBeUndefined()
    expect(buildResultSourceQuery("SELECT (1;\nSELECT 2", 500).pagination).toBeUndefined()
  })
})

describe("createResultSourceUC", () => {
  test("keeps each source isolated while it loads pages", () => {
    const harness = createQueryHarness()
    const firstSource = createResultSource(harness.query)
    const secondSource = createResultSource(harness.query)

    const firstJobId = firstSource.executeQuery('SELECT * FROM "main"."library_loans"')
    const secondJobId = secondSource.executeQuery('SELECT * FROM "main"."books"')

    expect(harness.executions).toHaveLength(2)
    expect(firstSource.getState().current?.job).toMatchObject({ jobId: firstJobId, status: "success" })
    expect(secondSource.getState().current?.job).toMatchObject({ jobId: secondJobId, status: "success" })

    const nextJobId = firstSource.loadNextPage()

    expect(firstSource.getState().current?.job).toMatchObject({ jobId: nextJobId, status: "success" })
    expect(firstSource.getState().current?.pagination?.offset).toBe(500)
    expect(secondSource.getState().current?.pagination?.offset).toBe(0)

    firstSource.dispose()
    secondSource.dispose()
  })

  test("loads the last page with a parallel count task", async () => {
    const harness = createQueryHarness()
    const resultSource = createResultSource(harness.query)

    resultSource.executeQuery('SELECT * FROM "main"."library_loans"')
    const lastJobId = await resultSource.loadLastPage()

    expect(resultSource.getState().current?.job).toMatchObject({ jobId: lastJobId, status: "success" })
    expect(resultSource.getState().current?.pagination).toMatchObject({
      offset: 1000,
      totalRows: 1205,
      isTotalRowsExact: true,
    })
    expect(harness.executions.some((execution) => execution.query.includes("COUNT(*)"))).toBe(true)

    resultSource.dispose()
  })

  test("clears pending count navigation without replacing the displayed result", () => {
    const harness = createQueryHarness()
    harness.setHoldCounts(true)
    const resultSource = createResultSource(harness.query)

    const firstJobId = resultSource.executeQuery('SELECT * FROM "main"."library_loans"')
    void resultSource.loadLastPage()

    expect(resultSource.getState().navigation).toEqual({ kind: "count" })
    resultSource.cancel()

    expect(resultSource.getState().navigation).toBeUndefined()
    expect(resultSource.getState().current?.job).toMatchObject({ jobId: firstJobId, status: "success" })

    resultSource.dispose()
  })

  test("starts a new last-page request after canceling the previous one", async () => {
    const harness = createQueryHarness()
    harness.setHoldCounts(true)
    const resultSource = createResultSource(harness.query)

    resultSource.executeQuery('SELECT * FROM "main"."library_loans"')
    void resultSource.loadLastPage()
    resultSource.cancel()

    harness.setHoldCounts(false)
    resultSource.executeQuery('SELECT * FROM "main"."books"')
    const lastJobId = await resultSource.loadLastPage()

    expect(resultSource.getState().current?.job).toMatchObject({ jobId: lastJobId, status: "success" })
    expect(harness.executions.filter((execution) => execution.query.includes("COUNT(*)"))).toHaveLength(2)

    resultSource.dispose()
  })
})
