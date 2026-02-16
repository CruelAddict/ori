import { type GraphSnapshot, loadGraphIncremental } from "@entities/resource-introspection/api/graph"
import {
  createResourceIntrospectionStore,
  type ResourceIntrospectionStore,
} from "@entities/resource-introspection/model/resource-introspection-store"
import type { Node, OriClient } from "@shared/lib/resources-client"
import type { Logger } from "pino"
import { createContext, useContext } from "solid-js"

type ResourceIntrospector = {
  refresh(): Promise<GraphSnapshot | null>
  ensureLoaded(): Promise<GraphSnapshot | null>
}

type ResourceIntrospectorDeps = {
  resourceName: string
  client: OriClient
  logger: Logger
  store: ResourceIntrospectionStore
}

export interface ResourceIntrospectionContextValue {
  getNodesById(resourceName: string): Record<string, Node>
  getRootIds(resourceName: string): string[]
  isLoading(resourceName: string): boolean
  getError(resourceName: string): string | null
  refresh(resourceName: string): Promise<GraphSnapshot | null>
  ensureLoaded(resourceName: string): Promise<GraphSnapshot | null>
}

export type ResourceIntrospectionContextDeps = {
  client: OriClient
  logger: Logger
}

export const ResourceIntrospectionContext = createContext<ResourceIntrospectionContextValue>()

export function createResourceIntrospectionContextValue(
  deps: ResourceIntrospectionContextDeps,
): ResourceIntrospectionContextValue {
  const store = createResourceIntrospectionStore()
  const introspectorsByResource = new Map<string, ResourceIntrospector>()

  const getIntrospector = (resourceName: string) => {
    const active = introspectorsByResource.get(resourceName)
    if (active) {
      return active
    }

    const introspector = createResourceIntrospector({
      resourceName,
      client: deps.client,
      logger: deps.logger,
      store,
    })
    introspectorsByResource.set(resourceName, introspector)
    return introspector
  }

  const refresh: ResourceIntrospectionContextValue["refresh"] = (resourceName) => {
    return getIntrospector(resourceName).refresh()
  }

  const ensureLoaded: ResourceIntrospectionContextValue["ensureLoaded"] = (resourceName) => {
    return getIntrospector(resourceName).ensureLoaded()
  }

  return {
    getNodesById: store.getNodesById,
    getRootIds: store.getRootIds,
    isLoading: store.isLoading,
    getError: store.getError,
    refresh,
    ensureLoaded,
  }
}

export function useResourceIntrospection(): ResourceIntrospectionContextValue {
  const context = useContext(ResourceIntrospectionContext)
  if (!context) {
    throw new Error("ResourceIntrospectionProvider is missing in component tree")
  }
  return context
}

function createResourceIntrospector(deps: ResourceIntrospectorDeps): ResourceIntrospector {
  let pending: Promise<GraphSnapshot | null> | null = null

  const refresh: ResourceIntrospector["refresh"] = () => {
    if (pending) {
      return pending
    }

    deps.store.start(deps.resourceName)
    deps.logger.debug({ resource: deps.resourceName }, "resource introspection fetch triggered")

    const request = loadGraphIncremental(
      deps.client,
      deps.resourceName,
      {
        onRoots: (_nodes, rootIds) => {
          deps.store.setRoots(deps.resourceName, rootIds)
        },
        onNode: (node) => {
          deps.store.upsertNode(deps.resourceName, node)
        },
      },
      deps.logger,
    )
      .then((snapshot) => {
        deps.store.succeed(deps.resourceName)
        deps.logger.debug(
          { resource: deps.resourceName, hasSnapshot: Boolean(snapshot) },
          "resource introspection fetch completed",
        )
        return snapshot
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err)
        deps.logger.error({ err, resource: deps.resourceName }, "resource introspection load failed")
        deps.store.fail(deps.resourceName, message)
        return null
      })
      .finally(() => {
        if (pending !== request) {
          return
        }
        pending = null
      })

    pending = request
    return request
  }

  const ensureLoaded: ResourceIntrospector["ensureLoaded"] = () => {
    if (pending) {
      return pending
    }
    if (deps.store.isLoaded(deps.resourceName)) {
      return Promise.resolve(null)
    }
    return refresh()
  }

  return {
    refresh,
    ensureLoaded,
  }
}
