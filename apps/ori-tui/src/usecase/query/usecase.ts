import type { OriClient, QueryExecResult, QueryResultView } from "@adapters/ori/client"
import { QUERY_JOB_COMPLETED_EVENT, type QueryJobCompletedEvent, type ServerEvent } from "@model/events"
import type { Logger } from "pino"

export type QueryJob = {
  jobId: string
  resourceName: string
  query: string
  status: "running" | "success" | "failed" | "canceled"
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

type QueryNotificationStyle = {
  level: "info" | "warn" | "success" | "error"
  channel: "statusline"
}

export type QueryUsecaseDeps = {
  resourceName: string
  client: OriClient
  logger: Logger
  notifications: {
    notify(message: string, style: QueryNotificationStyle): void
  }
  subscribeEvents: (listener: (event: ServerEvent) => void) => () => void
}

export type QueryUsecase = {
  getState(): QueryState
  subscribe(listener: Listener): () => void
  setQueryText(text: string): void
  executeQuery(query: string): Promise<void>
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

  const notifyError = () => {
    deps.notifications.notify("query failed", { level: "error", channel: "statusline" })
  }

  const notifySuccess = (result?: QueryResultView, durationMs?: number) => {
    const text = formatSuccessNotification(result, durationMs)
    deps.notifications.notify(text, { level: "success", channel: "statusline" })
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

  const executeQuery = async (query: string) => {
    const currentJob = state.job
    if (currentJob && currentJob.status === "running") {
      deps.logger.warn(
        { resourceName: deps.resourceName, jobId: currentJob.jobId },
        "query already running for resource; ignoring new execute request",
      )
      return
    }

    const jobId = generateJobId()
    setState((current) => ({
      ...current,
      job: {
        jobId,
        resourceName: deps.resourceName,
        query,
        status: "running",
      },
    }))

    try {
      const execResult = await executeQueryRequest(deps.client, deps.logger, deps.resourceName, query, jobId)
      if (execResult.status === "failed") {
        setState((current) => ({
          ...current,
          job: {
            jobId,
            resourceName: deps.resourceName,
            query,
            status: "failed",
            error: execResult.message,
          },
        }))
        notifyError()
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
          error: errorMessage,
        },
      }))
      notifyError()
      deps.logger.error({ jobId, resourceName: deps.resourceName, err }, "query execution threw")
    }
  }

  const cancelQuery = async () => {
    const currentJob = state.job
    if (!currentJob || currentJob.status !== "running") {
      return
    }

    try {
      await cancelQueryRequest(deps.client, deps.logger, currentJob.jobId)
    } catch (err) {
      notifyError()
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
          },
        }))
        notifySuccess(result, durationMs)
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        setState((current) => ({
          ...current,
          job: {
            ...currentJob,
            status: "failed",
            error: errorMessage,
            durationMs,
          },
        }))
        notifyError()
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
      },
    }))

    if (nextStatus === "success") {
      notifySuccess(undefined, durationMs)
      return
    }

    if (nextStatus === "failed") {
      notifyError()
    }
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
): Promise<QueryExecResult> {
  try {
    return await client.queryExec(resourceName, jobId, query)
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

function formatSuccessNotification(result?: QueryResultView, durationMs?: number) {
  if (result && result.rows.length > 0) {
    const rowsText = `${result.rowCount} row${result.rowCount === 1 ? "" : "s"}`
    const truncatedText = result.truncated ? " (truncated)" : ""
    const durationText = ` in ${durationMs}ms`
    return `${rowsText}${truncatedText}${durationText}`
  }
  if (result?.rowsAffected !== undefined) {
    const durationText = durationMs ? ` in ${durationMs}ms` : ""
    return `${result.rowsAffected} row${result.rowsAffected === 1 ? "" : "s"} affected${durationText}`
  }
  const durationText = durationMs ? ` (${durationMs}ms)` : ""
  return `Query completed successfully${durationText}`
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

export const generateJobId = () => crypto.randomUUID()
