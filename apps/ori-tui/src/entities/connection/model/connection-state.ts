import { useOriClient } from "@app/providers/client"
import { useEventStream } from "@app/providers/events"
import { useLogger } from "@app/providers/logger"
import { CONNECTION_STATE_EVENT, type ServerEvent } from "@shared/lib/events"
import type { Resource } from "@src/entities/resource/model/resource"
import { useResources } from "@src/entities/resource/model/resource-list-store"
import type { ResourceConnectResult } from "@src/shared/lib/resources-client"
import type { Accessor } from "solid-js"
import { createContext, createMemo, onCleanup, useContext } from "solid-js"
import { createStore, type SetStoreFunction } from "solid-js/store"

export type ConnectionLifecycle = "idle" | "requesting" | "waiting" | "connected" | "failed"

export type ConnectionRecord = {
  resource: Resource
  status: ConnectionLifecycle
  message?: string
  error?: string
  lastUpdated: number
}

type ConnectionStateStore = {
  records: Record<string, ConnectionRecord>
}

type RecordRecipe = (current: ConnectionRecord) => ConnectionRecord
type SetRecordOptions = { resource?: Resource }
type SetRecordFn = (resourceName: string, recipe: RecordRecipe, options?: SetRecordOptions) => void

type ConnectionActions = {
  connect(resource: Resource): Promise<void>
  clear(resourceName: string): void
}

interface ConnectionStateContextValue extends ConnectionActions {
  records: Accessor<Record<string, ConnectionRecord>>
  getRecord: (resourceName: string) => ConnectionRecord | undefined
}

export const ConnectionStateContext = createContext<ConnectionStateContextValue>()

export function createConnectionStateContextValue(): ConnectionStateContextValue {
  const client = useOriClient()
  const logger = useLogger()
  const eventStream = useEventStream()
  const { resourceMap } = useResources()

  const [state, setState] = createStore<ConnectionStateStore>({
    records: {},
  })

  const recordStore = createRecordStore({
    state,
    setState,
    logger,
    resourceMap,
  })

  const handleResourceConnectResult = createResourceConnectResultHandler({
    logger,
    setRecord: recordStore.setRecord,
  })

  const connect = createConnectAction({
    client,
    logger,
    setRecord: recordStore.setRecord,
    handleResourceConnectResult,
  })

  const handleServerEvent = createServerEventHandler({
    logger,
    resolveResource: recordStore.resolveResource,
    setRecord: recordStore.setRecord,
    state,
  })

  const unsubscribe = eventStream.subscribe(handleServerEvent)
  onCleanup(() => unsubscribe())

  return {
    records: recordStore.recordsAccessor,
    getRecord: recordStore.getRecord,
    connect,
    clear: recordStore.clear,
  }
}

type RecordStoreDeps = {
  state: ConnectionStateStore
  setState: SetStoreFunction<ConnectionStateStore>
  logger: ReturnType<typeof useLogger>
  resourceMap: Accessor<Map<string, Resource>>
}

function createRecordStore(deps: RecordStoreDeps) {
  const getRecord = (resourceName: string) => deps.state.records[resourceName]

  const resolveResource = (resourceName: string): Resource | undefined => {
    return getRecord(resourceName)?.resource ?? deps.resourceMap().get(resourceName)
  }

  const setRecord: SetRecordFn = (resourceName, recipe, options) => {
    deps.setState("records", resourceName, (current) => {
      const resource = current?.resource ?? options?.resource ?? resolveResource(resourceName)
      if (!resource) {
        deps.logger.warn(
          { resource: resourceName },
          "connection state update skipped for unknown resource",
        )
        return current
      }
      const base =
        current ??
        ({
          resource,
          status: "idle",
          lastUpdated: Date.now(),
        } satisfies ConnectionRecord)
      return recipe(base)
    })
  }

  const clear = (resourceName: string) => {
    deps.setState("records", (records) => {
      const next = { ...records }
      delete next[resourceName]
      return next
    })
  }

  const recordsAccessor: Accessor<Record<string, ConnectionRecord>> = () => deps.state.records

  return {
    getRecord,
    resolveResource,
    setRecord,
    clear,
    recordsAccessor,
  }
}

type ResourceConnectResultHandler = (resourceName: string, resource: Resource, result: ResourceConnectResult) => void

type ResourceConnectResultHandlerDeps = {
  logger: ReturnType<typeof useLogger>
  setRecord: SetRecordFn
}

function createResourceConnectResultHandler({ logger, setRecord }: ResourceConnectResultHandlerDeps): ResourceConnectResultHandler {
  return (resourceName, resource, result) => {
    logger.debug({ resource: resourceName, result: result.result }, "connect RPC result")
    if (result.result === "success") {
      setRecord(
        resourceName,
        (current) => ({
          ...current,
          resource,
          status: "connected",
          message: undefined,
          error: undefined,
          lastUpdated: Date.now(),
        }),
        { resource },
      )
      return
    }
    if (result.result === "fail") {
      setRecord(
        resourceName,
        (current) => ({
          ...current,
          resource,
          status: "failed",
          message: result.userMessage,
          error: result.userMessage,
          lastUpdated: Date.now(),
        }),
        { resource },
      )
      return
    }
    setRecord(
      resourceName,
      (current) => {
        if (current.status === "connected") {
          logger.debug(
            { resource: resourceName },
            "connect RPC result ignored because connection is already established",
          )
          return current
        }
        logger.debug({ resource: resourceName }, "connect RPC indicates pending connection state; marking waiting")
        return {
          ...current,
          resource,
          status: "waiting",
          message: result.userMessage ?? "Waiting for backend...",
          error: undefined,
          lastUpdated: Date.now(),
        } satisfies ConnectionRecord
      },
      { resource },
    )
  }
}

type ConnectActionDeps = {
  client: ReturnType<typeof useOriClient>
  logger: ReturnType<typeof useLogger>
  setRecord: SetRecordFn
  handleResourceConnectResult: ResourceConnectResultHandler
}

function createConnectAction({ client, logger, setRecord, handleResourceConnectResult }: ConnectActionDeps) {
  return async (resource: Resource) => {
    const { name } = resource
    setRecord(
      name,
      (current) => ({
        ...current,
        resource,
        status: "requesting",
        message: "Requesting connection...",
        error: undefined,
        lastUpdated: Date.now(),
      }),
      { resource },
    )
    try {
      const result = await client.connect(name)
      handleResourceConnectResult(name, resource, result)
    } catch (err) {
      logger.error({ err, resource: name }, "connect RPC error")
      setRecord(
        name,
        (current) => ({
          ...current,
          resource,
          status: "failed",
          message: "Connection request failed",
          error: err instanceof Error ? err.message : String(err),
          lastUpdated: Date.now(),
        }),
        { resource },
      )
    }
  }
}

type ServerEventHandlerDeps = {
  logger: ReturnType<typeof useLogger>
  resolveResource: (resourceName: string) => Resource | undefined
  setRecord: SetRecordFn
  state: ConnectionStateStore
}

function createServerEventHandler({ logger, resolveResource, setRecord, state }: ServerEventHandlerDeps) {
  return (event: ServerEvent) => {
    if (event.type !== CONNECTION_STATE_EVENT) {
      return
    }
    const { resourceName, state: lifecycle, message, error } = event.payload
    const previous = state.records[resourceName]
    logger.debug(
      {
        resource: resourceName,
        lifecycle,
        previousStatus: previous?.status,
      },
      "connection lifecycle event received",
    )
    const resource = resolveResource(resourceName)
    if (!resource) {
      logger.warn(
        { resource: resourceName, lifecycle },
        "received connection lifecycle event for unknown resource",
      )
      return
    }
    if (lifecycle === "connected") {
      logger.debug({ resource: resourceName }, "marking connection as connected")
      setRecord(
        resourceName,
        (current) => ({
          ...current,
          resource,
          status: "connected",
          message: undefined,
          error: undefined,
          lastUpdated: Date.now(),
        }),
        { resource },
      )
      return
    }
    if (lifecycle === "failed") {
      logger.debug({ resource: resourceName }, "marking connection as failed")
      setRecord(
        resourceName,
        (current) => ({
          ...current,
          resource,
          status: "failed",
          message: message ?? "Connection request failed",
          error: error ?? message,
          lastUpdated: Date.now(),
        }),
        { resource },
      )
      return
    }
    if (lifecycle === "connecting") {
      setRecord(
        resourceName,
        (current) => {
          if (current.status === "connected") {
            logger.debug(
              { resource: resourceName },
              "ignoring connecting event for already connected resource",
            )
            return current
          }
          logger.debug({ resource: resourceName }, "marking connection as waiting")
          return {
            ...current,
            resource,
            status: "waiting",
            message: message ?? "Waiting for backend...",
            error: undefined,
            lastUpdated: Date.now(),
          } satisfies ConnectionRecord
        },
        { resource },
      )
    }
  }
}

export function useConnectionState(): ConnectionStateContextValue {
  const ctx = useContext(ConnectionStateContext)
  if (!ctx) {
    throw new Error("ConnectionEntityProvider is missing in component tree")
  }
  return ctx
}
