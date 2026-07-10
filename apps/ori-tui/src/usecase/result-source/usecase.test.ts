import { describe, expect, test } from "bun:test"
import type { Node, OriClient, QueryExecOptions, QueryResultView, ResourceConnectResult } from "@adapters/ori/client"
import { QUERY_JOB_COMPLETED_EVENT, type ServerEvent } from "@model/events"
import type { Resource } from "@model/resource"
import { createQueryUC } from "@usecase/query/usecase"
import pino from "pino"
import { buildResultSourceQuery, createResultSourceUC } from "./usecase"

type Execution = {
  jobId: string
  query: string
  options?: QueryExecOptions
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(predicate: () => boolean) {
  for (const _ of Array.from({ length: 20 })) {
    if (predicate()) {
      return
    }
    await sleep(0)
  }
  throw new Error("condition was not met")
}

function createClientHarness(initialTotalRows = 1205) {
  const listeners = new Set<(event: ServerEvent) => void>()
  const results = new Map<string, QueryResultView>()
  const executions: Execution[] = []
  let totalRows = initialTotalRows

  const emit = (event: ServerEvent) => {
    for (const listener of listeners) {
      listener(event)
    }
  }

  const client: OriClient = {
    listResources: async (): Promise<Resource[]> => [],
    connect: async (): Promise<ResourceConnectResult> => ({ result: "success" }),
    getNodes: async (): Promise<Node[]> => [],
    queryExec: async (resourceName, jobId, query, _params, options) => {
      executions.push({ jobId, query, options })
      results.set(jobId, createResult(query, totalRows))
      queueMicrotask(() => {
        emit({
          type: QUERY_JOB_COMPLETED_EVENT,
          payload: {
            jobId,
            resourceName,
            status: "success",
            finishedAt: new Date().toISOString(),
            durationMs: 1,
            stored: true,
          },
        })
      })
      return { jobId, status: "running" }
    },
    queryGetResult: async (jobId) => {
      const result = results.get(jobId)
      if (result) {
        return result
      }
      throw new Error(`missing result for ${jobId}`)
    },
    queryCancel: async () => {},
    openEventStream: () => () => {},
  }

  return {
    client,
    executions,
    setTotalRows: (value: number) => {
      totalRows = value
    },
    subscribeEvents: (listener: (event: ServerEvent) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

function createResult(query: string, totalRows: number): QueryResultView {
  if (query.includes("COUNT(*)")) {
    return {
      columns: [{ name: "total_rows", type: "integer" }],
      rows: [[String(totalRows)]],
      rowCount: 1,
      truncated: false,
    }
  }

  const offset = Number(query.match(/OFFSET (\d+)/)?.[1] ?? 0)
  const rows = Math.min(500, Math.max(0, totalRows - offset))
  return {
    columns: [{ name: "id", type: "integer" }],
    rows: Array.from({ length: rows }, (_, index) => [String(offset + index + 1)]),
    rowCount: rows,
    truncated: offset + rows < totalRows,
  }
}

describe("buildResultSourceQuery", () => {
  test("adds a page window to simple select queries", () => {
    const plan = buildResultSourceQuery('SELECT * FROM "main"."books";', 500)

    expect(plan).toEqual({
      query: 'SELECT * FROM "main"."books" LIMIT 501 OFFSET 0',
      sourceQuery: 'SELECT * FROM "main"."books"',
      maxRows: 500,
      pagination: {
        pageSize: 500,
        offset: 0,
        totalRows: 501,
        isTotalRowsExact: false,
      },
    })
  })

  test("does not auto-limit queries with explicit filters or windows", () => {
    expect(buildResultSourceQuery("SELECT * FROM books WHERE id = 1", 500).pagination).toBeUndefined()
    expect(buildResultSourceQuery("SELECT * FROM books LIMIT 10", 500).pagination).toBeUndefined()
    expect(buildResultSourceQuery("SELECT * FROM books OFFSET 10", 500).pagination).toBeUndefined()
    expect(buildResultSourceQuery("WITH books AS (SELECT 1) SELECT * FROM books", 500).pagination).toBeUndefined()
    expect(buildResultSourceQuery("DELETE FROM books", 500).pagination).toBeUndefined()
  })

  test("does not auto-limit when resource auto-limit is disabled", () => {
    const plan = buildResultSourceQuery("SELECT * FROM books", null)

    expect(plan).toEqual({
      query: "SELECT * FROM books",
      sourceQuery: "SELECT * FROM books",
    })
  })

  test("ignores keywords inside strings, comments, quoted identifiers, and nested queries", () => {
    expect(buildResultSourceQuery("SELECT 'where limit offset' AS value FROM books", 500).pagination).toBeDefined()
    expect(buildResultSourceQuery('SELECT "where" FROM books', 500).pagination).toBeDefined()
    expect(buildResultSourceQuery("SELECT * FROM (SELECT * FROM books WHERE id = 1) b", 500).pagination).toBeDefined()
    expect(buildResultSourceQuery("SELECT * FROM books -- WHERE id = 1", 500).pagination).toBeDefined()
  })
})

describe("createResultSourceUC", () => {
  test("loads next and last pages from the displayed source query", async () => {
    const harness = createClientHarness()
    const query = createQueryUC({
      resourceName: "local-sqlite",
      client: harness.client,
      logger: pino({ enabled: false }),
      subscribeEvents: harness.subscribeEvents,
    })
    const resultSource = createResultSourceUC({
      resourceName: "local-sqlite",
      logger: pino({ enabled: false }),
      query,
      getAutoLimitRows: () => 500,
    })

    const firstJobId = resultSource.executeQuery('SELECT * FROM "main"."library_loans"')
    await waitFor(() => firstJobId !== undefined && query.getJob(firstJobId)?.status === "success")
    expect(harness.executions.at(0)?.query).toBe('SELECT * FROM "main"."library_loans" LIMIT 501 OFFSET 0')
    expect(harness.executions.at(0)?.options).toEqual({ maxRows: 500 })

    const nextJobId = resultSource.loadNextPage()
    await waitFor(
      () =>
        nextJobId !== undefined &&
        query.getJob(nextJobId)?.status === "success" &&
        resultSource.getState().current?.pagination?.offset === 500,
    )
    expect(harness.executions.at(-1)?.query).toBe('SELECT * FROM "main"."library_loans" LIMIT 501 OFFSET 500')

    const lastJobId = await resultSource.loadLastPage()
    await waitFor(
      () =>
        lastJobId !== undefined &&
        query.getJob(lastJobId)?.status === "success" &&
        resultSource.getState().current?.pagination?.offset === 1000,
    )
    expect(harness.executions.some((execution) => execution.query.includes("COUNT(*)"))).toBe(true)
    expect(harness.executions.at(-1)?.query).toBe('SELECT * FROM "main"."library_loans" LIMIT 501 OFFSET 1000')

    query.dispose()
  })

  test("keeps the largest estimated total when returning to an earlier page", async () => {
    const harness = createClientHarness()
    const query = createQueryUC({
      resourceName: "local-sqlite",
      client: harness.client,
      logger: pino({ enabled: false }),
      subscribeEvents: harness.subscribeEvents,
    })
    const resultSource = createResultSourceUC({
      resourceName: "local-sqlite",
      logger: pino({ enabled: false }),
      query,
      getAutoLimitRows: () => 500,
    })

    const firstJobId = resultSource.executeQuery('SELECT * FROM "main"."library_loans"')
    await waitFor(() => firstJobId !== undefined && query.getJob(firstJobId)?.status === "success")

    const nextJobId = resultSource.loadNextPage()
    await waitFor(
      () =>
        nextJobId !== undefined &&
        query.getJob(nextJobId)?.status === "success" &&
        resultSource.getState().current?.pagination?.offset === 500 &&
        resultSource.getState().current?.pagination?.totalRows === 1001,
    )
    expect(resultSource.getState().current?.pagination).toMatchObject({
      totalRows: 1001,
      isTotalRowsExact: false,
    })

    const previousJobId = resultSource.loadPreviousPage()
    await waitFor(
      () =>
        previousJobId !== undefined &&
        query.getJob(previousJobId)?.status === "success" &&
        resultSource.getState().current?.pagination?.offset === 0 &&
        resultSource.getState().current?.pagination?.totalRows === 1001,
    )
    expect(resultSource.getState().current?.pagination).toMatchObject({
      totalRows: 1001,
      isTotalRowsExact: false,
    })

    query.dispose()
  })

  test("shrinks the total when the last page returns fewer rows", async () => {
    const harness = createClientHarness()
    const query = createQueryUC({
      resourceName: "local-sqlite",
      client: harness.client,
      logger: pino({ enabled: false }),
      subscribeEvents: harness.subscribeEvents,
    })
    const resultSource = createResultSourceUC({
      resourceName: "local-sqlite",
      logger: pino({ enabled: false }),
      query,
      getAutoLimitRows: () => 500,
    })

    const firstJobId = resultSource.executeQuery('SELECT * FROM "main"."library_loans"')
    await waitFor(() => firstJobId !== undefined && query.getJob(firstJobId)?.status === "success")

    const lastJobId = await resultSource.loadLastPage()
    await waitFor(
      () =>
        lastJobId !== undefined &&
        query.getJob(lastJobId)?.status === "success" &&
        resultSource.getState().current?.pagination?.offset === 1000 &&
        resultSource.getState().current?.pagination?.totalRows === 1205,
    )
    expect(resultSource.getState().current?.pagination).toMatchObject({
      totalRows: 1205,
      isTotalRowsExact: true,
    })

    harness.setTotalRows(1100)
    const refreshedLastJobId = await resultSource.loadLastPage()
    await waitFor(
      () =>
        refreshedLastJobId !== undefined &&
        query.getJob(refreshedLastJobId)?.status === "success" &&
        resultSource.getState().current?.pagination?.offset === 1000 &&
        resultSource.getState().current?.pagination?.totalRows === 1100,
    )
    expect(resultSource.getState().current?.pagination).toMatchObject({
      totalRows: 1100,
      isTotalRowsExact: true,
    })

    query.dispose()
  })
})
