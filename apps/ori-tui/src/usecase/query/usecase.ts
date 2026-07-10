import type { OriClient, QueryExecOptions, QueryExecResult, QueryResultView } from "@adapters/ori/client"
import { QUERY_JOB_COMPLETED_EVENT, type QueryJobCompletedEvent, type ServerEvent } from "@model/events"
import type { Logger } from "pino"

export type QueryJob = {
  jobId: string
  resourceName: string
  query: string
  status: "running" | "success" | "failed" | "canceled"
  startedAt: number
  finishedAt?: number
  result?: QueryResultView
  error?: string
  message?: string
  durationMs?: number
}

export type QueryState = {
  queryText: string
  jobsById: Record<string, QueryJob>
}

type Listener = () => void
type ResultWaiter = {
  resolve: (result: QueryResultView) => void
  reject: (err: Error) => void
}

export type QueryUsecaseDeps = {
  resourceName: string
  client: OriClient
  logger: Logger
  subscribeEvents: (listener: (event: ServerEvent) => void) => () => void
}

export type QueryUsecase = {
  getState(): QueryState
  subscribe(listener: Listener): () => void
  setQueryText(text: string): void
  executeQuery(query: string, options?: QueryExecOptions): string
  failQuery(query: string, error: string): string
  getJob(jobId: string): QueryJob | undefined
  waitForResult(jobId: string): Promise<QueryResultView>
  cancelQuery(jobId: string): Promise<void>
  clearQuery(): void
  dispose(): void
}

export function createQueryUC(deps: QueryUsecaseDeps): QueryUsecase {
  let state: QueryState = {
    queryText: "",
    jobsById: {},
  }
  const listeners = new Set<Listener>()
  const resultWaiters = new Map<string, ResultWaiter[]>()

  const emit = () => {
    for (const listener of listeners) {
      listener()
    }
  }

  const setState = (recipe: (current: QueryState) => QueryState) => {
    state = recipe(state)
    emit()
  }

  const setJob = (jobId: string, recipe: (current: QueryJob | undefined) => QueryJob) => {
    setState((current) => ({
      ...current,
      jobsById: {
        ...current.jobsById,
        [jobId]: recipe(current.jobsById[jobId]),
      },
    }))
  }

  const resolveWaiters = (jobId: string, result: QueryResultView) => {
    settleWaiters(resultWaiters, jobId, (waiter) => waiter.resolve(result))
  }

  const rejectWaiters = (jobId: string, err: Error) => {
    settleWaiters(resultWaiters, jobId, (waiter) => waiter.reject(err))
  }

  const rejectAllWaiters = (err: Error) => {
    for (const jobId of Array.from(resultWaiters.keys())) {
      rejectWaiters(jobId, err)
    }
  }

  const setQueryText = (text: string) => {
    setState((current) => ({
      ...current,
      queryText: text,
    }))
  }

  const clearQuery = () => {
    rejectAllWaiters(new Error("query state cleared"))
    setState(() => ({
      queryText: "",
      jobsById: {},
    }))
  }

  const executeQuery = (query: string, options?: QueryExecOptions) => {
    const jobId = generateJobId()
    const startedAt = Date.now()
    setJob(jobId, () => ({
      jobId,
      resourceName: deps.resourceName,
      query,
      status: "running",
      startedAt,
    }))

    void executeQueryRequest(deps.client, deps.logger, deps.resourceName, query, jobId, options)
      .then((execResult) => {
        if (execResult.status !== "failed") {
          return
        }
        const error = execResult.message || "query failed"
        setJob(jobId, () => ({
          jobId,
          resourceName: deps.resourceName,
          query,
          status: "failed",
          startedAt,
          finishedAt: Date.now(),
          error,
        }))
        rejectWaiters(jobId, new Error(error))
        deps.logger.error({ jobId, message: execResult.message }, "query execution failed immediately")
      })
      .catch((err) => {
        const error = err instanceof Error ? err.message : String(err)
        setJob(jobId, () => ({
          jobId,
          resourceName: deps.resourceName,
          query,
          status: "failed",
          startedAt,
          finishedAt: Date.now(),
          error,
        }))
        rejectWaiters(jobId, new Error(error))
        deps.logger.error({ jobId, resourceName: deps.resourceName, err }, "query execution threw")
      })

    return jobId
  }

  const failQuery = (query: string, error: string) => {
    const jobId = generateJobId()
    const finishedAt = Date.now()
    setJob(jobId, () => ({
      jobId,
      resourceName: deps.resourceName,
      query,
      status: "failed",
      startedAt: finishedAt,
      finishedAt,
      error,
    }))
    deps.logger.warn({ jobId, resourceName: deps.resourceName, error }, "query execution rejected locally")
    return jobId
  }

  const getJob = (jobId: string) => state.jobsById[jobId]

  const waitForResult = (jobId: string) => {
    const settled = getSettledResult(state.jobsById[jobId])
    if (settled.result) {
      return Promise.resolve(settled.result)
    }
    if (settled.error) {
      return Promise.reject(settled.error)
    }

    return new Promise<QueryResultView>((resolve, reject) => {
      const waiters = resultWaiters.get(jobId) ?? []
      waiters.push({ resolve, reject })
      resultWaiters.set(jobId, waiters)
    })
  }

  const cancelQuery = async (jobId: string) => {
    const job = state.jobsById[jobId]
    if (!job || job.status !== "running") {
      return
    }

    try {
      await cancelQueryRequest(deps.client, deps.logger, jobId)
    } catch (err) {
      deps.logger.error({ err, resourceName: deps.resourceName, jobId }, "cancel query failed")
    }
  }

  const handleQueryJobCompleted = async (event: QueryJobCompletedEvent) => {
    const jobId = event.payload.jobId
    const resourceName = event.payload.resourceName
    const status = event.payload.status
    const error = event.payload.error
    const message = event.payload.message
    const stored = event.payload.stored
    const durationMs = event.payload.durationMs
    const finishedAt = parseFinishedAt(event.payload.finishedAt)

    deps.logger.debug({ jobId, resourceName, status, stored }, "query execution: received job completed event")
    if (resourceName !== deps.resourceName) {
      return
    }

    const currentJob = state.jobsById[jobId]
    if (!currentJob) {
      deps.logger.debug({ jobId, resourceName }, "query execution: ignoring event - unknown job")
      return
    }

    if (status === "success" && stored) {
      try {
        const result = await fetchQueryResultRequest(deps.client, deps.logger, jobId)
        setJob(jobId, () => ({
          ...currentJob,
          status: "success",
          result,
          durationMs,
          finishedAt,
        }))
        resolveWaiters(jobId, result)
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        setJob(jobId, () => ({
          ...currentJob,
          status: "failed",
          error: errorMessage,
          durationMs,
          finishedAt,
        }))
        rejectWaiters(jobId, new Error(errorMessage))
        deps.logger.error({ jobId, resourceName, err }, "query execution: failed to fetch query result")
      }
      return
    }

    const nextStatus = resolveCompletedStatus(status)
    setJob(jobId, () => ({
      ...currentJob,
      status: nextStatus,
      error: error || message,
      durationMs,
      finishedAt,
    }))
    rejectWaiters(jobId, new Error(error || message || `query ${nextStatus}`))
  }

  const unsubscribeEvents = deps.subscribeEvents((event) => {
    if (event.type !== QUERY_JOB_COMPLETED_EVENT) {
      return
    }
    void handleQueryJobCompleted(event)
  })

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setQueryText,
    executeQuery,
    failQuery,
    getJob,
    waitForResult,
    cancelQuery,
    clearQuery,
    dispose: () => {
      unsubscribeEvents()
      rejectAllWaiters(new Error("query usecase disposed"))
      listeners.clear()
    },
  }
}

function getSettledResult(job: QueryJob | undefined): { result?: QueryResultView; error?: Error } {
  if (!job) {
    return { error: new Error("query job not found") }
  }
  if (job.status === "success" && job.result) {
    return { result: job.result }
  }
  if (job.status === "success") {
    return { error: new Error("query result is not stored") }
  }
  if (job.status === "failed" || job.status === "canceled") {
    return { error: new Error(job.error || job.message || `query ${job.status}`) }
  }
  return {}
}

function settleWaiters(
  waiters: Map<string, ResultWaiter[]>,
  jobId: string,
  settle: (waiter: ResultWaiter) => void,
) {
  const pending = waiters.get(jobId)
  if (!pending) {
    return
  }
  waiters.delete(jobId)
  for (const waiter of pending) {
    settle(waiter)
  }
}

async function executeQueryRequest(
  client: OriClient,
  logger: Logger,
  resourceName: string,
  query: string,
  jobId: string,
  options?: QueryExecOptions,
): Promise<QueryExecResult> {
  try {
    return await client.queryExec(resourceName, jobId, query, undefined, options)
  } catch (err) {
    logger.error({ err, resourceName, jobId }, "failed to execute query")
    throw err
  }
}

async function fetchQueryResultRequest(client: OriClient, logger: Logger, jobId: string): Promise<QueryResultView> {
  try {
    return await client.queryGetResult(jobId)
  } catch (err) {
    logger.error({ err, jobId }, "failed to fetch query result")
    throw err
  }
}

async function cancelQueryRequest(client: OriClient, logger: Logger, jobId: string): Promise<void> {
  try {
    await client.queryCancel(jobId)
  } catch (err) {
    logger.error({ err, jobId }, "failed to cancel query")
    throw err
  }
}

function resolveCompletedStatus(status: string): QueryJob["status"] {
  if (status === "success") {
    return "success"
  }
  if (status === "canceled") {
    return "canceled"
  }
  return "failed"
}

function parseFinishedAt(value: string): number {
  const parsed = Date.parse(value)
  if (Number.isFinite(parsed)) {
    return parsed
  }
  return Date.now()
}

export const generateJobId = () => crypto.randomUUID()
