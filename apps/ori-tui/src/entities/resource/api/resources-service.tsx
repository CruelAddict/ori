import { useOriClient } from "@app/providers/client"
import type { Resource } from "@src/entities/resource/model/resource"
import type { JSX } from "solid-js"
import { createContext, useContext } from "solid-js"

export type ResourcesService = {
  listResources(): Promise<Resource[]>
}

const ResourcesServiceContext = createContext<ResourcesService>()

export type ResourcesServiceProviderProps = {
  children: JSX.Element
}

export function ResourcesServiceProvider(props: ResourcesServiceProviderProps) {
  const client = useOriClient()
  const service: ResourcesService = {
    listResources: () => client.listResources(),
  }

  return <ResourcesServiceContext.Provider value={service}>{props.children}</ResourcesServiceContext.Provider>
}

export function useResourcesService(): ResourcesService {
  const ctx = useContext(ResourcesServiceContext)
  if (!ctx) {
    throw new Error("ResourcesServiceProvider is missing in component tree")
  }
  return ctx
}
