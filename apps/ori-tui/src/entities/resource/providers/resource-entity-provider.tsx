import { useOriClient } from "@app/providers/client"
import { useEventStream } from "@app/providers/events"
import { useLogger } from "@app/providers/logger"
import { createResourceEntityContextValue, ResourceEntityContext } from "@src/entities/resource/model/resource-store"
import type { JSX } from "solid-js"

export type ResourceEntityProviderProps = {
  children: JSX.Element
}

export function ResourceEntityProvider(props: ResourceEntityProviderProps) {
  const client = useOriClient()
  const logger = useLogger()
  const events = useEventStream()

  const value = createResourceEntityContextValue({
    client,
    logger,
    subscribeEvents: events.subscribe,
  })

  return <ResourceEntityContext.Provider value={value}>{props.children}</ResourceEntityContext.Provider>
}
