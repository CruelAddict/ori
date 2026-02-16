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
  upsertNode(resourceName: string, node: Node): void
  succeed(resourceName: string): void
  fail(resourceName: string, message: string): void
}

export function createResourceIntrospectionStore(): ResourceIntrospectionStore {
  const [state, setState] = createStore<ResourceIntrospectionState>({
    entriesByResource: {},
  })

  const getEntry = (resourceName: string) => state.entriesByResource[resourceName]

  const setEntry = (resourceName: string, recipe: (entry: ResourceGraphEntry) => ResourceGraphEntry) => {
    setState("entriesByResource", resourceName, (current) => recipe(current ?? createEmptyEntry()))
  }

  const ensureEntry = (resourceName: string) => {
    setState("entriesByResource", resourceName, (current) => current ?? createEmptyEntry())
  }

  const getNodesById = (resourceName: string) => getEntry(resourceName)?.nodesById ?? {}
  const getRootIds = (resourceName: string) => getEntry(resourceName)?.rootIds ?? []
  const isLoading = (resourceName: string) => Boolean(getEntry(resourceName)?.loading)
  const isLoaded = (resourceName: string) => Boolean(getEntry(resourceName)?.loaded)
  const getError = (resourceName: string) => getEntry(resourceName)?.error ?? null

  const start = (resourceName: string) => {
    setEntry(resourceName, (current) => ({
      ...current,
      nodesById: {},
      rootIds: [],
      loading: true,
      loaded: false,
      error: null,
    }))
  }

  const setRoots = (resourceName: string, rootIds: string[]) => {
    ensureEntry(resourceName)
    setState("entriesByResource", resourceName, "rootIds", [...rootIds])
  }

  const upsertNode = (resourceName: string, node: Node) => {
    ensureEntry(resourceName)
    setState("entriesByResource", resourceName, "nodesById", node.id, node)
  }

  const succeed = (resourceName: string) => {
    setEntry(resourceName, (current) => ({
      ...current,
      loading: false,
      loaded: true,
      error: null,
    }))
  }

  const fail = (resourceName: string, message: string) => {
    setEntry(resourceName, (current) => ({
      ...current,
      loading: false,
      loaded: false,
      error: message,
    }))
  }

  return {
    getNodesById,
    getRootIds,
    isLoading,
    isLoaded,
    getError,
    start,
    setRoots,
    upsertNode,
    succeed,
    fail,
  }
}

function createEmptyEntry(): ResourceGraphEntry {
  return {
    nodesById: {},
    rootIds: [],
    loading: false,
    loaded: false,
    error: null,
  }
}
