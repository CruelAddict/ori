import type { Node, OriClient } from "@adapters/ori/client"
import { type GraphSnapshot, loadGraphIncremental } from "@usecase/introspection/load"
import type { Logger } from "pino"

type Listener = () => void

export type ResourceIntrospectionState = {
  nodesById: Record<string, Node>
  rootIds: string[]
  loading: boolean
  loaded: boolean
  error: string | null
}

export type ResourceIntrospectionUsecaseDeps = {
  resourceName: string
  client: OriClient
  logger: Logger
}

export type ResourceIntrospectionUsecase = {
  getState(): ResourceIntrospectionState
  subscribe(listener: Listener): () => void
  refresh(): Promise<GraphSnapshot | null>
  load(): Promise<GraphSnapshot | null>
  dispose(): void
}

export function createResourceIntrospectionUC(deps: ResourceIntrospectionUsecaseDeps): ResourceIntrospectionUsecase {
  let state: ResourceIntrospectionState = {
    nodesById: {},
    rootIds: [],
    loading: false,
    loaded: false,
    error: null,
  }
  const listeners = new Set<Listener>()
  let pending: Promise<GraphSnapshot | null> | null = null

  const emit = () => {
    for (const listener of listeners) {
      listener()
    }
  }

  const setState = (recipe: (current: ResourceIntrospectionState) => ResourceIntrospectionState) => {
    state = recipe(state)
    emit()
  }

  const refresh = () => {
    if (pending) {
      return pending
    }

    setState(() => ({
      nodesById: {},
      rootIds: [],
      loading: true,
      loaded: false,
      error: null,
    }))
    deps.logger.debug({ resource: deps.resourceName }, "resource introspection fetch triggered")

    const request = loadGraphIncremental(
      deps.client,
      deps.resourceName,
      {
        onRoots: (nodes, rootIds) => {
          setState((current) => {
            const nodesById = { ...current.nodesById }
            for (const node of nodes) {
              nodesById[node.id] = node
            }
            return {
              ...current,
              nodesById,
              rootIds: [...rootIds],
            }
          })
        },
        onNodes: (nodes) => {
          if (nodes.length === 0) {
            return
          }

          setState((current) => {
            const nodesById = { ...current.nodesById }
            for (const node of nodes) {
              nodesById[node.id] = node
            }
            return {
              ...current,
              nodesById,
            }
          })
        },
      },
      deps.logger,
    )
      .then((snapshot) => {
        setState((current) => ({
          ...current,
          loading: false,
          loaded: true,
          error: null,
        }))
        deps.logger.debug(
          { resource: deps.resourceName, hasSnapshot: Boolean(snapshot) },
          "resource introspection fetch completed",
        )
        return snapshot
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err)
        deps.logger.error({ err, resource: deps.resourceName }, "resource introspection load failed")
        setState((current) => ({
          ...current,
          loading: false,
          loaded: false,
          error: message,
        }))
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

  const load = () => {
    if (pending) {
      return pending
    }
    if (state.loaded) {
      return Promise.resolve(null)
    }
    return refresh()
  }

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    refresh,
    load,
    dispose: () => {
      listeners.clear()
    },
  }
}
