import { QUERY_JOB_COMPLETED_EVENT, type QueryJobCompletedEvent, type ServerEvent } from "@shared/lib/events"
import type { OriClient, QueryExecResult, QueryResultView } from "@shared/lib/resources-client"
import type { Logger } from "pino"
import type { Accessor } from "solid-js"
import { createContext, onCleanup, useContext } from "solid-js"
import { createStore } from "solid-js/store"

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

type QueryStoreState = {
  jobsByResource: Record<string, QueryJob | undefined>
  queryTextByResource: Record<string, string>
}

type QueryActions = {
  setQueryText(resourceName: string, text: string): void
  executeQuery(resourceName: string, query: string): Promise<void>
  cancelQuery(resourceName: string): Promise<void>
  clearQuery(resourceName: string): void
}

export interface QueryContextValue extends QueryActions {
  getJob: (resourceName: string) => QueryJob | undefined
  getQueryText: (resourceName: string) => string
}

export type QueryContextDeps = {
  client: OriClient
  logger: Logger
  notifications: {
    notify(message: string, style: QueryNotificationStyle): void
  }
  subscribeEvents: (listener: (event: ServerEvent) => void) => () => void
}

type QueryNotificationStyle = {
  level: "info" | "warn" | "success" | "error"
  channel: "statusline"
}

export const QueryContext = createContext<QueryContextValue>()

export function createQueryContextValue(deps: QueryContextDeps): QueryContextValue {
  const [state, setState] = createStore<QueryStoreState>({
    jobsByResource: {},
    queryTextByResource: {},
  })

  const notifyError = (_?: string) => {
    deps.notifications.notify("query failed", { level: "error", channel: "statusline" })
  }

  const notifySuccess = (result?: QueryResultView, durationMs?: number) => {
    const text = formatSuccessNotification(result, durationMs)
    deps.notifications.notify(text, { level: "success", channel: "statusline" })
  }

  const setQueryText = (resourceName: string, text: string) => {
    setState("queryTextByResource", resourceName, text)
  }

  const clearQuery = (resourceName: string) => {
    setState("queryTextByResource", resourceName, "")
    setState("jobsByResource", resourceName, undefined)
  }

  const executeQuery = async (resourceName: string, query: string) => {
    const currentJob = state.jobsByResource[resourceName]
    if (currentJob && currentJob.status === "running") {
      deps.logger.warn(
        { resourceName, jobId: currentJob.jobId },
        "query already running for resource; ignoring new execute request",
      )
      return
    }

    const jobId = generateJobId()
    setState("jobsByResource", resourceName, {
      jobId,
      resourceName,
      query,
      status: "running",
    })

    try {
      const execResult = await executeQueryRequest(deps.client, deps.logger, resourceName, query, jobId)
      if (execResult.status === "failed") {
        setState("jobsByResource", resourceName, {
          jobId,
          resourceName,
          query,
          status: "failed",
          error: execResult.message,
        })
        notifyError(execResult.message)
        deps.logger.error({ jobId, message: execResult.message }, "query execution failed immediately")
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      setState("jobsByResource", resourceName, {
        jobId,
        resourceName,
        query,
        status: "failed",
        error: errorMessage,
      })
      notifyError(errorMessage)
      deps.logger.error({ jobId, resourceName, err }, "query execution threw")
    }
  }

  const cancelQuery = async (resourceName: string) => {
    const currentJob = state.jobsByResource[resourceName]
    if (!currentJob || currentJob.status !== "running") {
      return
    }

    try {
      await cancelQueryRequest(deps.client, deps.logger, currentJob.jobId)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      notifyError(errorMessage)
      deps.logger.error({ err, resourceName, jobId: currentJob.jobId }, "cancel query failed")
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
    const currentJob = state.jobsByResource[resourceName]
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
        setState("jobsByResource", resourceName, {
          ...currentJob,
          status: "success",
          result,
          durationMs,
        })
        notifySuccess(result, durationMs)
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        setState("jobsByResource", resourceName, {
          ...currentJob,
          status: "failed",
          error: errorMessage,
          durationMs,
        })
        notifyError(errorMessage)
        deps.logger.error({ jobId, resourceName, err }, "query execution: failed to fetch query result")
      }
      return
    }

    const nextStatus = resolveCompletedStatus(status)
    setState("jobsByResource", resourceName, {
      ...currentJob,
      status: nextStatus,
      error: error || message,
      durationMs,
    })

    if (nextStatus === "success") {
      notifySuccess(undefined, durationMs)
      return
    }

    if (nextStatus === "failed") {
      notifyError(error || message)
    }
  }

  const unsubscribe = deps.subscribeEvents((event) => {
    if (event.type !== QUERY_JOB_COMPLETED_EVENT) {
      return
    }
    void handleQueryJobCompleted(event)
  })

  onCleanup(() => unsubscribe())

  return {
    getJob: (resourceName: string) => state.jobsByResource[resourceName],
    getQueryText: (resourceName: string) => state.queryTextByResource[resourceName] ?? "",
    setQueryText,
    executeQuery,
    cancelQuery,
    clearQuery,
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

export function useQuery(): QueryContextValue {
  const ctx = useContext(QueryContext)
  if (!ctx) {
    throw new Error("QueryProvider is missing in component tree")
  }
  return ctx
}

export function useQueryJob(resourceName: Accessor<string | null>) {
  const ctx = useQuery()
  return () => {
    const name = resourceName()
    if (!name) return undefined
    return ctx.getJob(name)
  }
}
