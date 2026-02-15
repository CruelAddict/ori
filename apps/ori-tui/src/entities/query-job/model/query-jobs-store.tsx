import { useLogger } from "@app/providers/logger"
import { useNotifications } from "@app/providers/notifications"
import type { QueryResultView } from "@shared/lib/resources-client"
import type { QueryJobCompletedEvent } from "@shared/lib/events"
import { useQueryJobsApi } from "@src/entities/query-job/api/api"
import type { Accessor, JSX } from "solid-js"
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

type QueryJobsStoreState = {
  jobsByResource: Record<string, QueryJob | undefined>
  queryTextByResource: Record<string, string>
}

type QueryJobsActions = {
  setQueryText(resourceName: string, text: string): void
  executeQuery(resourceName: string, query: string): Promise<void>
  cancelQuery(resourceName: string): Promise<void>
  clearQuery(resourceName: string): void
}

export interface QueryJobsContextValue extends QueryJobsActions {
  getJob: (resourceName: string) => QueryJob | undefined
  getQueryText: (resourceName: string) => string
}

const QueryJobsContext = createContext<QueryJobsContextValue>()

export type QueryJobsStoreProviderProps = {
  children: JSX.Element
}

export function QueryJobsStoreProvider(props: QueryJobsStoreProviderProps) {
  const api = useQueryJobsApi()
  const logger = useLogger()
  const notifications = useNotifications()

  const [state, setState] = createStore<QueryJobsStoreState>({
    jobsByResource: {},
    queryTextByResource: {},
  })

  const notifyError = (_?: string) => {
    notifications.notify("query failed", { level: "error", channel: "statusline" })
  }

  const notifySuccess = (result?: QueryResultView, durationMs?: number) => {
    const text = formatSuccessNotification(result, durationMs)
    notifications.notify(text, { level: "success", channel: "statusline" })
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
      logger.warn(
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
      const execResult = await api.executeQuery(resourceName, query, jobId)
      if (execResult.status === "failed") {
        setState("jobsByResource", resourceName, {
          jobId,
          resourceName,
          query,
          status: "failed",
          error: execResult.message,
        })
        notifyError(execResult.message)
        logger.error({ jobId, message: execResult.message }, "query execution failed immediately")
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
      logger.error({ jobId, resourceName, err }, "query-jobs-store: query execution threw")
    }
  }

  const cancelQuery = async (resourceName: string) => {
    const currentJob = state.jobsByResource[resourceName]
    if (!currentJob || currentJob.status !== "running") {
      return
    }

    try {
      await api.cancelQuery(currentJob.jobId)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      notifyError(errorMessage)
      logger.error({ err, resourceName, jobId: currentJob.jobId }, "query-jobs-store: cancel failed")
    }
  }

  const handleQueryJobCompleted = async (event: QueryJobCompletedEvent) => {
    const { jobId, resourceName, status, error, message, stored, durationMs } = event.payload
    logger.debug({ jobId, resourceName, status, stored }, "query-jobs-store: received job completed event")
    const currentJob = state.jobsByResource[resourceName]
    if (!currentJob || currentJob.jobId !== jobId) {
      logger.debug(
        { jobId, resourceName, currentJobId: currentJob?.jobId },
        "query-jobs-store: ignoring event - job mismatch or no current job",
      )
      return
    }

    if (status === "success" && stored) {
      try {
        const result = await api.fetchQueryResult(jobId)
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
        logger.error({ jobId, resourceName, err }, "query-jobs-store: failed to fetch query result")
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
    } else if (nextStatus === "failed") {
      notifyError(error || message)
    }
  }

  const unsubscribe = api.onJobCompleted(handleQueryJobCompleted)
  onCleanup(() => unsubscribe())

  const getJob = (resourceName: string) => state.jobsByResource[resourceName]
  const getQueryText = (resourceName: string) => state.queryTextByResource[resourceName] ?? ""

  const value: QueryJobsContextValue = {
    getJob,
    getQueryText,
    setQueryText,
    executeQuery,
    cancelQuery,
    clearQuery,
  }

  return <QueryJobsContext.Provider value={value}>{props.children}</QueryJobsContext.Provider>
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

export function useQueryJobs(): QueryJobsContextValue {
  const ctx = useContext(QueryJobsContext)
  if (!ctx) {
    throw new Error("QueryJobsStoreProvider is missing in component tree")
  }
  return ctx
}

export function useQueryJob(resourceName: Accessor<string | null>) {
  const ctx = useQueryJobs()
  return () => {
    const name = resourceName()
    if (!name) return undefined
    return ctx.getJob(name)
  }
}
