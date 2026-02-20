import type { OriClient, ResourceConnectResult } from "@adapters/ori/client"
import { CONNECTION_STATE_EVENT, type ServerEvent } from "@model/events"
import type { Resource } from "@model/resource"
import type { Logger } from "pino"

export type ResourceConnectionStatus = "idle" | "requesting" | "waiting" | "connected" | "failed"

export type ResourceConnectionState = {
  resourceName: string
  status: ResourceConnectionStatus
  message?: string
  error?: string
  lastUpdated: number
}

export type ResourceState = {
  resources: Resource[]
  loading: boolean
  error: string | null
  connectionsByName: Record<string, ResourceConnectionState>
}

type Listener = () => void
type ResourceConnectionRecipe = (current: ResourceConnectionState) => ResourceConnectionState

export type ResourceUsecaseDeps = {
  client: OriClient
  logger: Logger
  subscribeEvents: (listener: (event: ServerEvent) => void) => () => void
}

export type ResourceUsecase = {
  getState(): ResourceState
  subscribe(listener: Listener): () => void
  refresh(): Promise<void>
  connect(resourceName: string): Promise<void>
  clearConnection(resourceName: string): void
  getResource(resourceName: string): Resource | undefined
  getConnection(resourceName: string): ResourceConnectionState | undefined
  dispose(): void
}

export function createResourceUC(deps: ResourceUsecaseDeps): ResourceUsecase {
  let state: ResourceState = {
    resources: [],
    loading: true,
    error: null,
    connectionsByName: {},
  }
  const listeners = new Set<Listener>()
  let refreshPromise: Promise<void> | null = null

  const emit = () => {
    for (const listener of listeners) {
      listener()
    }
  }

  const setState = (recipe: (current: ResourceState) => ResourceState) => {
    state = recipe(state)
    emit()
  }

  const setConnection = (resourceName: string, recipe: ResourceConnectionRecipe) => {
    setState((current) => {
      const previous = current.connectionsByName[resourceName] ?? createBaseConnection(resourceName)
      return {
        ...current,
        connectionsByName: {
          ...current.connectionsByName,
          [resourceName]: recipe(previous),
        },
      }
    })
  }

  const clearConnection = (resourceName: string) => {
    setState((current) => {
      if (!current.connectionsByName[resourceName]) {
        return current
      }

      const connectionsByName = { ...current.connectionsByName }
      delete connectionsByName[resourceName]

      return {
        ...current,
        connectionsByName,
      }
    })
  }

  const handleConnectResult = createResourceConnectResultHandler({
    logger: deps.logger,
    setConnection,
  })

  const connect = createConnectAction({
    client: deps.client,
    logger: deps.logger,
    setConnection,
    handleConnectResult,
  })

  const handleServerEvent = createServerEventHandler({
    logger: deps.logger,
    setConnection,
    getConnection: (resourceName: string) => state.connectionsByName[resourceName],
  })

  const refresh = async () => {
    if (refreshPromise) {
      return refreshPromise
    }

    const next = (async () => {
      setState((current) => ({
        ...current,
        loading: true,
        error: null,
      }))

      try {
        const resources = await deps.client.listResources()
        setState((current) => ({
          ...current,
          resources,
        }))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setState((current) => ({
          ...current,
          error: message,
        }))
        deps.logger.error({ err }, "failed to load resources")
      } finally {
        refreshPromise = null
        setState((current) => ({
          ...current,
          loading: false,
        }))
      }
    })()

    refreshPromise = next
    return next
  }

  const unsubscribeEvents = deps.subscribeEvents(handleServerEvent)
  void refresh()

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    refresh,
    connect,
    clearConnection,
    getResource: (resourceName: string) => state.resources.find((resource) => resource.name === resourceName),
    getConnection: (resourceName: string) => state.connectionsByName[resourceName],
    dispose: () => {
      unsubscribeEvents()
      listeners.clear()
    },
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
