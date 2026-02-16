import { useOriClient } from "@app/providers/client"
import { useEventStream } from "@app/providers/events"
import { useLogger } from "@app/providers/logger"
import { useNotifications } from "@app/providers/notifications"
import {
  createQueryContextValue,
  QueryContext,
  type QueryJob,
  useQuery,
  useQueryJob,
} from "@src/entities/query/model/query-store"
import type { JSX } from "solid-js"

export type QueryProviderProps = {
  children: JSX.Element
}

export function QueryProvider(props: QueryProviderProps) {
  const client = useOriClient()
  const logger = useLogger()
  const eventStream = useEventStream()
  const notifications = useNotifications()

  const value = createQueryContextValue({
    client,
    logger,
    notifications,
    subscribeEvents: eventStream.subscribe,
  })

  return <QueryContext.Provider value={value}>{props.children}</QueryContext.Provider>
}

export { type QueryJob, useQuery, useQueryJob }
