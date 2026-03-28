import type { Node, OriClient } from "@adapters/ori/client"
import { type GraphSnapshot, hydrateGraphIncremental, loadGraphIncremental } from "@usecase/introspection/load"
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
  ensureNodes(nodeIds: string[]): Promise<void>
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
  let hydratePending: Promise<void> | null = null
  let version = 0
  const hydrateQueue = new Set<string>()

  const emit = () => {
    for (const listener of listeners) {
      listener()
    }
  }

  const setState = (recipe: (current: ResourceIntrospectionState) => ResourceIntrospectionState) => {
    state = recipe(state)
    emit()
  }

  const mergeNodes = (nodes: Node[]) => {
    if (nodes.length === 0) return
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
  }

  const mergeNodesFor = (targetVersion: number, nodes: Node[]) => {
    if (targetVersion !== version) return
    mergeNodes(nodes)
  }

  const runHydrateQueue = () => {
    if (hydratePending) {
      return hydratePending
    }

    const targetVersion = version

    const request = (async () => {
      while (hydrateQueue.size > 0) {
        if (targetVersion !== version) return
        const ids = Array.from(hydrateQueue)
        hydrateQueue.clear()
        const knownNodes = new Map(Object.entries(state.nodesById))
        await hydrateGraphIncremental(
          deps.client,
          deps.resourceName,
          ids,
          knownNodes,
          { onNodes: (nodes) => mergeNodesFor(targetVersion, nodes) },
          deps.logger,
        )
      }
    })().finally(() => {
      if (hydratePending !== request) return
      hydratePending = null
    })

    hydratePending = request
    return request
  }

  const refresh = () => {
    if (pending) {
      return pending
    }

    version += 1
    const targetVersion = version
    hydrateQueue.clear()
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
          if (targetVersion !== version) return
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
        onNodes: (nodes) => mergeNodesFor(targetVersion, nodes),
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
        if (pending !== request) return
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

  const ensureNodes = async (nodeIds: string[]) => {
    for (const nodeId of nodeIds) {
      if (!nodeId) continue
      if (state.nodesById[nodeId]) continue
      hydrateQueue.add(nodeId)
    }
    if (hydrateQueue.size === 0) return
    if (pending) {
      await pending
    }
    await runHydrateQueue()
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
    ensureNodes,
    dispose: () => {
      listeners.clear()
      hydrateQueue.clear()
    },
  }
}
