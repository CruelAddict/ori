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
  job?: QueryJob
  queryText: string
}

type Listener = () => void

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
  executeQuery(query: string, options?: QueryExecOptions): Promise<void>
  failQuery(query: string, error: string): void
  cancelQuery(): Promise<void>
  clearQuery(): void
  dispose(): void
}

export function createQueryUC(deps: QueryUsecaseDeps): QueryUsecase {
  let state: QueryState = {
    queryText: "",
  }
  const listeners = new Set<Listener>()

  const emit = () => {
    for (const listener of listeners) {
      listener()
    }
  }

  const setState = (recipe: (current: QueryState) => QueryState) => {
    state = recipe(state)
    emit()
  }

  const setQueryText = (text: string) => {
    setState((current) => ({
      ...current,
      queryText: text,
    }))
  }

  const clearQuery = () => {
    setState(() => ({
      queryText: "",
      job: undefined,
    }))
  }

  const executeQuery = async (query: string, options?: QueryExecOptions) => {
    const currentJob = state.job
    if (currentJob && currentJob.status === "running") {
      deps.logger.warn(
        { resourceName: deps.resourceName, jobId: currentJob.jobId },
        "query already running for resource; ignoring new execute request",
      )
      return
    }

    const jobId = generateJobId()
    const startedAt = Date.now()
    setState((current) => ({
      ...current,
      job: {
        jobId,
        resourceName: deps.resourceName,
        query,
        status: "running",
        startedAt,
      },
    }))

    try {
      const execResult = await executeQueryRequest(deps.client, deps.logger, deps.resourceName, query, jobId, options)
      if (execResult.status === "failed") {
        setState((current) => ({
          ...current,
          job: {
            jobId,
            resourceName: deps.resourceName,
            query,
            status: "failed",
            startedAt,
            finishedAt: Date.now(),
            error: execResult.message,
          },
        }))
        deps.logger.error({ jobId, message: execResult.message }, "query execution failed immediately")
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      setState((current) => ({
        ...current,
        job: {
          jobId,
          resourceName: deps.resourceName,
          query,
          status: "failed",
          startedAt,
          finishedAt: Date.now(),
          error: errorMessage,
        },
      }))
      deps.logger.error({ jobId, resourceName: deps.resourceName, err }, "query execution threw")
    }
  }

  const failQuery = (query: string, error: string) => {
    const currentJob = state.job
    if (currentJob && currentJob.status === "running") {
      deps.logger.warn(
        { resourceName: deps.resourceName, jobId: currentJob.jobId },
        "query already running for resource; ignoring local failure",
      )
      return
    }

    const jobId = generateJobId()
    const finishedAt = Date.now()
    setState((current) => ({
      ...current,
      job: {
        jobId,
        resourceName: deps.resourceName,
        query,
        status: "failed",
        startedAt: finishedAt,
        finishedAt,
        error,
      },
    }))
    deps.logger.warn({ jobId, resourceName: deps.resourceName, error }, "query execution rejected locally")
  }

  const cancelQuery = async () => {
    const currentJob = state.job
    if (!currentJob || currentJob.status !== "running") {
      return
    }

    try {
      await cancelQueryRequest(deps.client, deps.logger, currentJob.jobId)
    } catch (err) {
      deps.logger.error({ err, resourceName: deps.resourceName, jobId: currentJob.jobId }, "cancel query failed")
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

    const currentJob = state.job
    if (!currentJob || currentJob.jobId !== jobId) {
      deps.logger.debug(
        { jobId, resourceName, currentJobId: currentJob?.jobId },
        "query execution: ignoring event - job mismatch or no current job",
      )
      return
    }

    if (status === "success" && stored) {
      try {
        const result = await fetchQueryResultRequest(deps.client, deps.logger, jobId)
        setState((current) => ({
          ...current,
          job: {
            ...currentJob,
            status: "success",
            result,
            durationMs,
            finishedAt,
          },
        }))
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        setState((current) => ({
          ...current,
          job: {
            ...currentJob,
            status: "failed",
            error: errorMessage,
            durationMs,
            finishedAt,
          },
        }))
        deps.logger.error({ jobId, resourceName, err }, "query execution: failed to fetch query result")
      }
      return
    }

    const nextStatus = resolveCompletedStatus(status)
    setState((current) => ({
      ...current,
      job: {
        ...currentJob,
        status: nextStatus,
        error: error || message,
        durationMs,
        finishedAt,
      },
    }))
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
    cancelQuery,
    clearQuery,
    dispose: () => {
      unsubscribeEvents()
      listeners.clear()
    },
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
