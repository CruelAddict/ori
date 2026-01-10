import { useOriClient } from "@app/providers/client"
import { useEventStream } from "@app/providers/events"
import { useLogger } from "@app/providers/logger"
import type { QueryExecResult, QueryResultView } from "@shared/lib/configurations-client"
import { QUERY_JOB_COMPLETED_EVENT, type QueryJobCompletedEvent, type ServerEvent } from "@shared/lib/events"
import type { JSX } from "solid-js"
import { createComponent, createContext, onCleanup, useContext } from "solid-js"

export type QueryJobsApi = {
  executeQuery(configurationName: string, query: string, jobId: string): Promise<QueryExecResult>
  fetchQueryResult(jobId: string): Promise<QueryResultView>
  onJobCompleted(listener: (event: QueryJobCompletedEvent) => void): () => void
}

const QueryJobsApiContext = createContext<QueryJobsApi>()

export type QueryJobsApiProviderProps = {
  children: JSX.Element
}

export function QueryJobsApiProvider(props: QueryJobsApiProviderProps) {
  const client = useOriClient()
  const logger = useLogger()
  const eventStream = useEventStream()
  const listeners = new Set<(event: QueryJobCompletedEvent) => void>()

  const executeQuery = async (configurationName: string, query: string, jobId: string) => {
    try {
      return await client.queryExec(configurationName, jobId, query)
    } catch (err) {
      logger.error({ err, configurationName }, "failed to execute query")
      throw err
    }
  }

  const fetchQueryResult = async (jobId: string) => {
    try {
      return await client.queryGetResult(jobId)
    } catch (err) {
      logger.error({ err, jobId }, "failed to fetch query result")
      throw err
    }
  }

  const onJobCompleted = (listener: (event: QueryJobCompletedEvent) => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  const emit = (event: QueryJobCompletedEvent) => {
    for (const listener of listeners) {
      listener(event)
    }
  }

  const handleServerEvent = (event: ServerEvent) => {
    logger.debug({ eventType: event.type }, "query-jobs-api: received event")
    if (event.type !== QUERY_JOB_COMPLETED_EVENT) {
      return
    }
    logger.debug({ jobId: event.payload.jobId, status: event.payload.status }, "query-jobs-api: emitting job completed")
    emit(event)
  }

  const unsubscribe = eventStream.subscribe(handleServerEvent)
  onCleanup(() => unsubscribe())

  const api: QueryJobsApi = {
    executeQuery,
    fetchQueryResult,
    onJobCompleted,
  }

  return createComponent(QueryJobsApiContext.Provider, {
    value: api,
    get children() {
      return props.children
    },
  })
}

export function useQueryJobsApi(): QueryJobsApi {
  const ctx = useContext(QueryJobsApiContext)
  if (!ctx) {
    throw new Error("QueryJobsApiProvider is missing in component tree")
  }
  return ctx
}
