import { useOriClient } from "@app/providers/client"
import { useLogger } from "@app/providers/logger"
import {
  createResourceIntrospectionContextValue,
  ResourceIntrospectionContext,
} from "@entities/resource-introspection/model/resource-introspector"
import type { JSX } from "solid-js"

export type ResourceIntrospectionProviderProps = {
  children: JSX.Element
}

export function ResourceIntrospectionProvider(props: ResourceIntrospectionProviderProps) {
  const client = useOriClient()
  const logger = useLogger()

  const value = createResourceIntrospectionContextValue({
    client,
    logger,
  })

  return <ResourceIntrospectionContext.Provider value={value}>{props.children}</ResourceIntrospectionContext.Provider>
}
