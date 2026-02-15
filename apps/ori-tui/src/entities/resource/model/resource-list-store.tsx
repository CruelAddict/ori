import { useLogger } from "@app/providers/logger"
import { useResourcesService } from "@src/entities/resource/api/resources-service"
import type { Resource } from "@src/entities/resource/model/resource"
import type { Accessor, JSX } from "solid-js"
import { createContext, createMemo, createSignal, onMount, useContext } from "solid-js"

type ResourceListStoreValue = {
  resources: Accessor<Resource[]>
  resourceMap: Accessor<Map<string, Resource>>
  loading: Accessor<boolean>
  error: Accessor<string | null>
  refresh: () => Promise<void>
}

const ResourceListStoreContext = createContext<ResourceListStoreValue>()

export type ResourceListStoreProviderProps = {
  children: JSX.Element
}

export function ResourceListStoreProvider(props: ResourceListStoreProviderProps) {
  const service = useResourcesService()
  const logger = useLogger()
  const [resources, setResources] = createSignal<Resource[]>([])
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)

  const resourceMap = createMemo(() => {
    const map = new Map<string, Resource>()
    for (const resource of resources()) {
      map.set(resource.name, resource)
    }
    return map
  })

  let refreshPromise: Promise<void> | null = null
  const refresh = async () => {
    if (refreshPromise) {
      return refreshPromise
    }
    const promise = (async () => {
      setLoading(true)
      setError(null)
      try {
        const list = await service.listResources()
        setResources(list)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setError(message)
        logger.error({ err }, "failed to load resources")
      } finally {
        setLoading(false)
        refreshPromise = null
      }
    })()
    refreshPromise = promise
    return promise
  }

  onMount(() => {
    void refresh()
  })

  const value: ResourceListStoreValue = {
    resources,
    resourceMap,
    loading,
    error,
    refresh,
  }

  return <ResourceListStoreContext.Provider value={value}>{props.children}</ResourceListStoreContext.Provider>
}

export function useResourceListStore(): ResourceListStoreValue {
  const ctx = useContext(ResourceListStoreContext)
  if (!ctx) {
    throw new Error("ResourceListStoreProvider is missing in component tree")
  }
  return ctx
}

export function useResources() {
  const store = useResourceListStore()
  return {
    resources: store.resources,
    resourceMap: store.resourceMap,
    loading: store.loading,
    error: store.error,
    refresh: store.refresh,
  }
}

export function useResourceByName(name: Accessor<string | null>) {
  const store = useResourceListStore()
  return createMemo(() => {
    const key = name()
    if (!key) return undefined
    return store.resourceMap().get(key)
  })
}
