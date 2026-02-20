import type { Resource } from "@model/resource"
import { useEventStream } from "@ui/providers/events"
import { useLogger } from "@ui/providers/logger"
import { createResourceUC, type ResourceConnectionState, type ResourceUsecase } from "@usecase/resource/usecase"
import { type Accessor, createContext, createMemo, createSignal, type JSX, onCleanup, useContext } from "solid-js"
import { useOriClient } from "./client"

export type ResourceEntityContextValue = {
  resources: Accessor<Resource[]>
  resourceMap: Accessor<Map<string, Resource>>
  loading: Accessor<boolean>
  error: Accessor<string | null>
  connections: Accessor<Record<string, ResourceConnectionState>>
  getResource(resourceName: string): Resource | undefined
  getConnection(resourceName: string): ResourceConnectionState | undefined
  refresh(): Promise<void>
  connect(resourceName: string): Promise<void>
  clearConnection(resourceName: string): void
  usecase: ResourceUsecase
}

export type ResourceProviderProps = {
  children: JSX.Element
}

const ResourceContext = createContext<ResourceEntityContextValue>()

export function ResourceProvider(props: ResourceProviderProps) {
  const client = useOriClient()
  const logger = useLogger()
  const eventStream = useEventStream()
  const usecase = createResourceUC({
    client,
    logger,
    subscribeEvents: eventStream.subscribe,
  })

  const [state, setState] = createSignal(usecase.getState())
  const unsubscribe = usecase.subscribe(() => {
    setState(usecase.getState())
  })

  onCleanup(() => {
    unsubscribe()
    usecase.dispose()
  })

  const resourceMap = createMemo(() => {
    const map = new Map<string, Resource>()
    for (const resource of state().resources) {
      map.set(resource.name, resource)
    }
    return map
  })

  const value: ResourceEntityContextValue = {
    resources: () => state().resources,
    resourceMap,
    loading: () => state().loading,
    error: () => state().error,
    connections: () => state().connectionsByName,
    getResource: usecase.getResource,
    getConnection: usecase.getConnection,
    refresh: usecase.refresh,
    connect: usecase.connect,
    clearConnection: usecase.clearConnection,
    usecase,
  }

  return <ResourceContext.Provider value={value}>{props.children}</ResourceContext.Provider>
}

export function useResourceEntity(): ResourceEntityContextValue {
  const context = useContext(ResourceContext)
  if (!context) {
    throw new Error("ResourceProvider is missing in component tree")
  }
  return context
}

export function useResourceByName(name: Accessor<string | null>) {
  const resource = useResourceEntity()
  return createMemo(() => {
    const key = name()
    if (!key) {
      return undefined
    }
    return resource.resourceMap().get(key)
  })
}

export function useResourceUsecase(): ResourceUsecase {
  return useResourceEntity().usecase
}

export type { ResourceConnectionState }
