import { describe, expect, test } from "bun:test"
import {
  type Node,
  type OriClient,
  OriRequestError,
  type QueryResultView,
  type ResourceConnectResult,
} from "@adapters/ori/client"
import { QUERY_JOB_COMPLETED_EVENT, type ServerEvent } from "@model/events"
import pino from "pino"
import { createQueryUC } from "./usecase"

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createClient(result: QueryResultView): OriClient {
  return {
    listResources: async () => [],
    connect: async (): Promise<ResourceConnectResult> => ({ result: "success" }),
    getNodes: async (): Promise<Node[]> => [],
    queryExec: async (_resourceName, jobId) => ({ jobId, status: "running" }),
    queryGetResult: async () => result,
    queryGetStatus: async (jobId) => ({
      jobId,
      resourceName: "local",
      status: "success",
      stored: true,
      finishedAt: Date.now(),
      durationMs: 1,
    }),
    queryCancel: async () => {},
    openEventStream: () => () => {},
  }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe("createQueryUC", () => {
  test("runs ordinary tasks independently", async () => {
    const result: QueryResultView = { columns: [], rows: [[1]], rowCount: 1, truncated: false }
    const query = createQueryUC({
      resourceName: "local",
      client: createClient(result),
      logger: pino({ enabled: false }),
      subscribeEvents: () => () => {},
      statusPollIntervalMs: 1,
    })

    const first = query.execute("SELECT 1")
    const second = query.execute("SELECT 2")
    const [firstOutcome, secondOutcome] = await Promise.all([first.done, second.done])

    expect(firstOutcome).toMatchObject({ jobId: first.jobId, status: "success", result })
    expect(secondOutcome).toMatchObject({ jobId: second.jobId, status: "success", result })
    query.dispose()
  })

  test("reconciles a completed job when its SSE event is lost", async () => {
    const result: QueryResultView = { columns: [], rows: [[1]], rowCount: 1, truncated: false }
    const query = createQueryUC({
      resourceName: "local",
      client: createClient(result),
      logger: pino({ enabled: false }),
      subscribeEvents: () => () => {},
      statusPollIntervalMs: 1,
    })

    const outcome = await query.execute("SELECT 1").done

    expect(outcome).toMatchObject({ status: "success", result })
    query.dispose()
  })

  test("uses a completion event before the first polling interval", async () => {
    const listeners = new Set<(event: ServerEvent) => void>()
    let statuses = 0
    const result: QueryResultView = { columns: [], rows: [[1]], rowCount: 1, truncated: false }
    const client = createClient(result)
    client.queryGetStatus = async () => {
      statuses += 1
      throw new Error("status should not be requested")
    }
    const query = createQueryUC({
      resourceName: "local",
      client,
      logger: pino({ enabled: false }),
      subscribeEvents: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      statusPollInitialDelayMs: 100,
    })

    const task = query.execute("SELECT 1")
    for (const listener of listeners) {
      listener({
        type: QUERY_JOB_COMPLETED_EVENT,
        payload: {
          jobId: task.jobId,
          resourceName: "local",
          status: "success",
          stored: true,
          finishedAt: new Date().toISOString(),
          durationMs: 1,
        },
      })
    }

    await expect(task.done).resolves.toMatchObject({ status: "success", result })
    expect(statuses).toBe(0)
    query.dispose()
  })

  test("requests cancellation before a delayed execution acknowledgement", async () => {
    const execution = deferred<{ jobId: string; status: "running" }>()
    let cancellations = 0
    const client = createClient({ columns: [], rows: [], rowCount: 0, truncated: false })
    client.queryExec = async () => await execution.promise
    client.queryCancel = async () => {
      cancellations += 1
    }
    const query = createQueryUC({
      resourceName: "local",
      client,
      logger: pino({ enabled: false }),
      subscribeEvents: () => () => {},
      statusPollInitialDelayMs: 1000,
    })
    const task = query.execute("SELECT 1")

    task.cancel()
    await sleep(1)
    expect(cancellations).toBe(1)

    execution.resolve({ jobId: task.jobId, status: "running" })
    await sleep(1)
    expect(cancellations).toBe(2)
    query.dispose()
  })

  test("retries cancellation after a transient failure", async () => {
    let cancellations = 0
    const client = createClient({ columns: [], rows: [], rowCount: 0, truncated: false })
    client.queryCancel = async () => {
      cancellations += 1
      if (cancellations === 1) {
        throw new Error("temporary cancellation error")
      }
    }
    const query = createQueryUC({
      resourceName: "local",
      client,
      logger: pino({ enabled: false }),
      subscribeEvents: () => () => {},
      statusPollInitialDelayMs: 1000,
    })
    const task = query.execute("SELECT 1")

    task.cancel()
    await sleep(1)
    task.cancel()
    await sleep(1)

    expect(cancellations).toBe(2)
    query.dispose()
  })

  test("fails an unacknowledged query when its job is not found", async () => {
    const client = createClient({ columns: [], rows: [], rowCount: 0, truncated: false })
    client.queryExec = async () => await new Promise(() => {})
    client.queryGetStatus = async () => {
      throw new OriRequestError("query job not found", "job_not_found")
    }
    const query = createQueryUC({
      resourceName: "local",
      client,
      logger: pino({ enabled: false }),
      subscribeEvents: () => () => {},
      execRequestTimeoutMs: 1,
      statusPollInitialDelayMs: 10,
    })

    await expect(query.execute("SELECT 1").done).resolves.toMatchObject({
      status: "failed",
      error: "query job not found",
    })
    query.dispose()
  })

  test("fails an acknowledged job when its status is permanently unavailable", async () => {
    const client = createClient({ columns: [], rows: [], rowCount: 0, truncated: false })
    client.queryGetStatus = async () => {
      throw new OriRequestError("query job not found", "job_not_found")
    }
    const query = createQueryUC({
      resourceName: "local",
      client,
      logger: pino({ enabled: false }),
      subscribeEvents: () => () => {},
      statusPollIntervalMs: 1,
    })

    await expect(query.execute("SELECT 1").done).resolves.toMatchObject({
      status: "failed",
      error: "query job not found",
    })
    query.dispose()
  })

  test("retries result retrieval", async () => {
    const result: QueryResultView = { columns: [], rows: [[1]], rowCount: 1, truncated: false }
    let attempts = 0
    const client = createClient(result)
    client.queryGetResult = async () => {
      attempts += 1
      if (attempts < 3) {
        throw new Error("temporary result error")
      }
      return result
    }
    const query = createQueryUC({
      resourceName: "local",
      client,
      logger: pino({ enabled: false }),
      subscribeEvents: () => () => {},
      statusPollIntervalMs: 1,
      resultRetryInitialDelayMs: 1,
    })

    await expect(query.execute("SELECT 1").done).resolves.toMatchObject({ status: "success", result })
    expect(attempts).toBe(3)
    query.dispose()
  })

  test("retries result retrieval after an attempt times out", async () => {
    const result: QueryResultView = { columns: [], rows: [[1]], rowCount: 1, truncated: false }
    let attempts = 0
    const client = createClient(result)
    client.queryGetResult = async (_jobId, _limit, _offset, signal) => {
      attempts += 1
      if (attempts > 1) {
        return result
      }
      return await new Promise((_, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true })
      })
    }
    const query = createQueryUC({
      resourceName: "local",
      client,
      logger: pino({ enabled: false }),
      subscribeEvents: () => () => {},
      statusPollIntervalMs: 1,
      resultRequestTimeoutMs: 1,
      resultRetryInitialDelayMs: 1,
    })

    await expect(query.execute("SELECT 1").done).resolves.toMatchObject({ status: "success", result })
    expect(attempts).toBe(2)
    query.dispose()
  })
})
