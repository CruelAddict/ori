import type { Node } from "@shared/lib/resources-client"
import { createStore } from "solid-js/store"

type ResourceGraphEntry = {
  nodesById: Record<string, Node>
  rootIds: string[]
  loading: boolean
  loaded: boolean
  error: string | null
}

type ResourceIntrospectionState = {
  entriesByResource: Record<string, ResourceGraphEntry>
}

export type ResourceIntrospectionStore = {
  getNodesById(resourceName: string): Record<string, Node>
  getRootIds(resourceName: string): string[]
  isLoading(resourceName: string): boolean
  isLoaded(resourceName: string): boolean
  getError(resourceName: string): string | null
  start(resourceName: string): void
  setRoots(resourceName: string, rootIds: string[]): void
  upsertNodes(resourceName: string, nodes: Node[]): void
  succeed(resourceName: string): void
  fail(resourceName: string, message: string): void
}

export function createResourceIntrospectionStore(): ResourceIntrospectionStore {
  const [state, setState] = createStore<ResourceIntrospectionState>({
    entriesByResource: {},
  })

  const getEntry = (resourceName: string) => state.entriesByResource[resourceName]

  const requireEntry = (resourceName: string): ResourceGraphEntry => {
    const entry = getEntry(resourceName)
    if (entry) {
      return entry
    }
    throw new Error(`resource introspection entry is missing for ${resourceName}`)
  }

  const getNodesById = (resourceName: string) => getEntry(resourceName)?.nodesById ?? {}
  const getRootIds = (resourceName: string) => getEntry(resourceName)?.rootIds ?? []
  const isLoading = (resourceName: string) => Boolean(getEntry(resourceName)?.loading)
  const isLoaded = (resourceName: string) => Boolean(getEntry(resourceName)?.loaded)
  const getError = (resourceName: string) => getEntry(resourceName)?.error ?? null

  const start = (resourceName: string) => {
    setState("entriesByResource", resourceName, {
      nodesById: {},
      rootIds: [],
      loading: true,
      loaded: false,
      error: null,
    })
  }

  const setRoots = (resourceName: string, rootIds: string[]) => {
    requireEntry(resourceName)
    setState("entriesByResource", resourceName, "rootIds", [...rootIds])
  }

  const upsertNodes = (resourceName: string, nodes: Node[]) => {
    if (nodes.length === 0) return
    const entry = requireEntry(resourceName)
    const next = { ...entry.nodesById }
    for (const node of nodes) {
      next[node.id] = node
    }
    setState("entriesByResource", resourceName, "nodesById", next)
  }

  const succeed = (resourceName: string) => {
    const entry = requireEntry(resourceName)
    setState("entriesByResource", resourceName, {
      ...entry,
      loading: false,
      loaded: true,
      error: null,
    })
  }

  const fail = (resourceName: string, message: string) => {
    const entry = requireEntry(resourceName)
    setState("entriesByResource", resourceName, {
      ...entry,
      loading: false,
      loaded: false,
      error: message,
    })
  }

  return {
    getNodesById,
    getRootIds,
    isLoading,
    isLoaded,
    getError,
    start,
    setRoots,
    upsertNodes,
    succeed,
    fail,
  }
}
