import { CONNECTION_STATE_EVENT, type ServerEvent } from "@shared/lib/events"
import type { OriClient, ResourceConnectResult } from "@shared/lib/resources-client"
import type { Logger } from "pino"
import type { Accessor } from "solid-js"
import { createContext, createMemo, createSignal, onCleanup, useContext } from "solid-js"
import { createStore, type SetStoreFunction } from "solid-js/store"
import type { Resource } from "./resource"

export type ResourceConnectionStatus = "idle" | "requesting" | "waiting" | "connected" | "failed"

export type ResourceConnectionState = {
  resourceName: string
  status: ResourceConnectionStatus
  message?: string
  error?: string
  lastUpdated: number
}

type ResourceConnectionsState = {
  connectionsByName: Record<string, ResourceConnectionState>
}

type ResourceConnectionRecipe = (current: ResourceConnectionState) => ResourceConnectionState

type ResourceConnectionStore = {
  getConnection(resourceName: string): ResourceConnectionState | undefined
  setConnection(resourceName: string, recipe: ResourceConnectionRecipe): void
  clearConnection(resourceName: string): void
  connectionsAccessor: Accessor<Record<string, ResourceConnectionState>>
}

type ResourceEntityActions = {
  refresh(): Promise<void>
  connect(resourceName: string): Promise<void>
  clearConnection(resourceName: string): void
}

export interface ResourceEntityContextValue extends ResourceEntityActions {
  resources: Accessor<Resource[]>
  resourceMap: Accessor<Map<string, Resource>>
  loading: Accessor<boolean>
  error: Accessor<string | null>
  connections: Accessor<Record<string, ResourceConnectionState>>
  getResource(resourceName: string): Resource | undefined
  getConnection(resourceName: string): ResourceConnectionState | undefined
}

export type ResourceEntityContextDeps = {
  client: OriClient
  logger: Logger
  subscribeEvents: (listener: (event: ServerEvent) => void) => () => void
}

export const ResourceEntityContext = createContext<ResourceEntityContextValue>()

export function createResourceEntityContextValue(deps: ResourceEntityContextDeps): ResourceEntityContextValue {
  const [resources, setResources] = createSignal<Resource[]>([])
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  const [connectionsState, setConnectionsState] = createStore<ResourceConnectionsState>({
    connectionsByName: {},
  })

  const resourceMap = createMemo(() => {
    const map = new Map<string, Resource>()
    for (const resource of resources()) {
      map.set(resource.name, resource)
    }
    return map
  })

  const connectionStore = createResourceConnectionStore(connectionsState, setConnectionsState)

  let refreshPromise: Promise<void> | null = null

  const refresh = async () => {
    if (refreshPromise) {
      return refreshPromise
    }

    const pending = (async () => {
      setLoading(true)
      setError(null)
      try {
        const list = await deps.client.listResources()
        setResources(list)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setError(message)
        deps.logger.error({ err }, "failed to load resources")
      } finally {
        setLoading(false)
        refreshPromise = null
      }
    })()

    refreshPromise = pending
    return pending
  }

  const handleConnectResult = createResourceConnectResultHandler({
    logger: deps.logger,
    setConnection: connectionStore.setConnection,
  })

  const connect = createConnectAction({
    client: deps.client,
    logger: deps.logger,
    setConnection: connectionStore.setConnection,
    handleConnectResult,
  })

  const handleServerEvent = createServerEventHandler({
    logger: deps.logger,
    setConnection: connectionStore.setConnection,
    getConnection: connectionStore.getConnection,
  })

  const unsubscribe = deps.subscribeEvents(handleServerEvent)
  onCleanup(() => unsubscribe())

  void refresh()

  return {
    resources,
    resourceMap,
    loading,
    error,
    connections: connectionStore.connectionsAccessor,
    getResource: (resourceName: string) => resourceMap().get(resourceName),
    getConnection: connectionStore.getConnection,
    refresh,
    connect,
    clearConnection: connectionStore.clearConnection,
  }
}

function createResourceConnectionStore(
  state: ResourceConnectionsState,
  setState: SetStoreFunction<ResourceConnectionsState>,
): ResourceConnectionStore {
  const getConnection = (resourceName: string) => state.connectionsByName[resourceName]

  const setConnection = (resourceName: string, recipe: ResourceConnectionRecipe) => {
    setState("connectionsByName", resourceName, (current) => recipe(current ?? createBaseConnection(resourceName)))
  }

  const clearConnection = (resourceName: string) => {
    setState("connectionsByName", (connectionsByName) => {
      if (!connectionsByName[resourceName]) {
        return connectionsByName
      }

      const next = { ...connectionsByName }
      delete next[resourceName]
      return next
    })
  }

  const connectionsAccessor: Accessor<Record<string, ResourceConnectionState>> = () => state.connectionsByName

  return {
    getConnection,
    setConnection,
    clearConnection,
    connectionsAccessor,
  }
}

function createBaseConnection(resourceName: string): ResourceConnectionState {
  return {
    resourceName,
    status: "idle",
    lastUpdated: Date.now(),
  }
}

type ConnectResultHandlerDeps = {
  logger: Logger
  setConnection(resourceName: string, recipe: ResourceConnectionRecipe): void
}

type ConnectResultHandler = (resourceName: string, result: ResourceConnectResult) => void

function createResourceConnectResultHandler(deps: ConnectResultHandlerDeps): ConnectResultHandler {
  return (resourceName, result) => {
    deps.logger.debug({ resource: resourceName, result: result.result }, "connect RPC result")

    if (result.result === "success") {
      deps.setConnection(resourceName, (current) => ({
        ...current,
        status: "connected",
        message: undefined,
        error: undefined,
        lastUpdated: Date.now(),
      }))
      return
    }

    if (result.result === "fail") {
      deps.setConnection(resourceName, (current) => ({
        ...current,
        status: "failed",
        message: result.userMessage,
        error: result.userMessage,
        lastUpdated: Date.now(),
      }))
      return
    }

    deps.setConnection(resourceName, (current) => {
      if (current.status === "connected") {
        deps.logger.debug(
          { resource: resourceName },
          "connect RPC result ignored because connection is already established",
        )
        return current
      }

      return {
        ...current,
        status: "waiting",
        message: result.userMessage ?? "Waiting for backend...",
        error: undefined,
        lastUpdated: Date.now(),
      }
    })
  }
}

type ConnectActionDeps = {
  client: OriClient
  logger: Logger
  setConnection(resourceName: string, recipe: ResourceConnectionRecipe): void
  handleConnectResult: ConnectResultHandler
}

function createConnectAction(deps: ConnectActionDeps) {
  return async (resourceName: string) => {
    deps.setConnection(resourceName, (current) => ({
      ...current,
      status: "requesting",
      message: "Requesting connection...",
      error: undefined,
      lastUpdated: Date.now(),
    }))

    try {
      const result = await deps.client.connect(resourceName)
      deps.handleConnectResult(resourceName, result)
    } catch (err) {
      deps.logger.error({ err, resource: resourceName }, "connect RPC error")
      deps.setConnection(resourceName, (current) => ({
        ...current,
        status: "failed",
        message: "Connection request failed",
        error: err instanceof Error ? err.message : String(err),
        lastUpdated: Date.now(),
      }))
    }
  }
}

type ServerEventHandlerDeps = {
  logger: Logger
  setConnection(resourceName: string, recipe: ResourceConnectionRecipe): void
  getConnection(resourceName: string): ResourceConnectionState | undefined
}

function createServerEventHandler(deps: ServerEventHandlerDeps) {
  return (event: ServerEvent) => {
    if (event.type !== CONNECTION_STATE_EVENT) {
      return
    }

    const resourceName = event.payload.resourceName
    const nextStatus = event.payload.state
    const message = event.payload.message
    const error = event.payload.error
    const previous = deps.getConnection(resourceName)

    deps.logger.debug(
      {
        resource: resourceName,
        lifecycle: nextStatus,
        previousStatus: previous?.status,
      },
      "connection lifecycle event received",
    )

    if (nextStatus === "connected") {
      deps.setConnection(resourceName, (current) => ({
        ...current,
        status: "connected",
        message: undefined,
        error: undefined,
        lastUpdated: Date.now(),
      }))
      return
    }

    if (nextStatus === "failed") {
      deps.setConnection(resourceName, (current) => ({
        ...current,
        status: "failed",
        message: message ?? "Connection request failed",
        error: error ?? message,
        lastUpdated: Date.now(),
      }))
      return
    }

    if (nextStatus === "connecting") {
      deps.setConnection(resourceName, (current) => {
        if (current.status === "connected") {
          deps.logger.debug({ resource: resourceName }, "ignoring connecting event for already connected resource")
          return current
        }

        return {
          ...current,
          status: "waiting",
          message: message ?? "Waiting for backend...",
          error: undefined,
          lastUpdated: Date.now(),
        }
      })
    }
  }
}

export function useResourceEntity(): ResourceEntityContextValue {
  const ctx = useContext(ResourceEntityContext)
  if (!ctx) {
    throw new Error("ResourceEntityProvider is missing in component tree")
  }
  return ctx
}

export function useResourceByName(name: Accessor<string | null>) {
  const entity = useResourceEntity()
  return createMemo(() => {
    const key = name()
    if (!key) {
      return undefined
    }
    return entity.resourceMap().get(key)
  })
}
