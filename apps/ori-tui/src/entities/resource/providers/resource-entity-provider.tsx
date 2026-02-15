import { ResourcesServiceProvider } from "@src/entities/resource/api/resources-service"
import { ResourceListStoreProvider } from "@src/entities/resource/model/resource-list-store"
import type { JSX } from "solid-js"

export type ResourceEntityProviderProps = {
  children: JSX.Element
}

export function ResourceEntityProvider(props: ResourceEntityProviderProps) {
  return (
    <ResourcesServiceProvider>
      <ResourceListStoreProvider>{props.children}</ResourceListStoreProvider>
    </ResourcesServiceProvider>
  )
}
