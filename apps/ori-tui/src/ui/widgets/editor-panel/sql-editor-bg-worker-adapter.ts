import type { BufferAutocompleteProvider, BufferAutocompleteResult } from "@ui/components/buffer"
import type { Logger } from "pino"
import { type Accessor, createSignal } from "solid-js"
import type {
  SqlEditorRequest,
  SqlEditorResponse,
  SqlEditorSchemaState,
  SqlStatementAnalysisResult,
} from "./sql-editor-protocol"

export type StatementAnalysis = {
  current: Accessor<SqlStatementAnalysisResult | undefined>
  analyze: (text: string, version: number) => void
}

export type SqlEditorBgWorkerAdapter = {
  autocomplete: BufferAutocompleteProvider
  statementAnalysis: StatementAnalysis
  dispose: () => void
}

type CreateSqlEditorBgWorkerAdapterOptions = {
  getState: () => SqlEditorSchemaState
  logger?: Logger
}

type QueuedAutocomplete = {
  text: string
  cursor: number
  signal: AbortSignal
  resolve: (result: BufferAutocompleteResult | undefined) => void
  onAbort: () => void
  finished: boolean
}

export function createSqlEditorBgWorkerAdapter(
  options: CreateSqlEditorBgWorkerAdapterOptions,
): SqlEditorBgWorkerAdapter {
  const [statementAnalysisState, setStatementAnalysisState] = createSignal<SqlStatementAnalysisResult>()
  const workerPath =
    import.meta.url === "file:///$bunfs/root/src/index.js"
      ? "/$bunfs/root/src/ui/widgets/editor-panel/sql-editor.worker.js"
      : new URL("./sql-editor.worker.ts", import.meta.url).href
  const worker = new Worker(workerPath)
  const pending = new Map<number, (message: SqlEditorResponse | undefined) => void>()
  let nextId = 0
  let disposed = false
  let workerAlive = true
  let cachedNodesById: SqlEditorSchemaState["nodesById"] | undefined
  let cachedRootIds: SqlEditorSchemaState["rootIds"] | undefined
  let cachedLoading: SqlEditorSchemaState["loading"] | undefined
  let cachedLoaded: SqlEditorSchemaState["loaded"] | undefined
  let latestAnalysisRequestId = -1
  let latestAnalysisVersion = -1
  let activeAutocomplete: { id: number; request: QueuedAutocomplete } | undefined
  let queuedAutocomplete: QueuedAutocomplete | undefined

  const clearPending = () => {
    const queued = queuedAutocomplete
    queuedAutocomplete = undefined
    if (queued) {
      finishAutocomplete(queued, undefined)
    }
    for (const handler of pending.values()) {
      handler(undefined)
    }
    pending.clear()
  }

  const postRequest = (message: SqlEditorRequest) => {
    worker.postMessage(message)
  }

  const finishAutocomplete = (request: QueuedAutocomplete, result: BufferAutocompleteResult | undefined) => {
    if (request.finished) {
      return
    }
    request.finished = true
    request.signal.removeEventListener("abort", request.onAbort)
    request.resolve(result)
  }

  const scheduleQueuedAutocomplete = () => {
    if (disposed || !workerAlive) {
      const queued = queuedAutocomplete
      queuedAutocomplete = undefined
      if (queued) {
        finishAutocomplete(queued, undefined)
      }
      return
    }
    if (activeAutocomplete || !queuedAutocomplete) {
      return
    }

    const request = queuedAutocomplete
    queuedAutocomplete = undefined
    if (!request || request.signal.aborted || request.finished) {
      if (request) {
        finishAutocomplete(request, undefined)
      }
      return
    }

    const id = nextId
    nextId += 1
    activeAutocomplete = { id, request }
    pending.set(id, (message) => {
      if (activeAutocomplete?.id === id) {
        activeAutocomplete = undefined
      }

      if (!message || message.type !== "autocomplete" || request.signal.aborted) {
        finishAutocomplete(request, undefined)
        scheduleQueuedAutocomplete()
        return
      }

      finishAutocomplete(request, message.result)
      scheduleQueuedAutocomplete()
    })
    postRequest({
      id,
      type: "autocomplete",
      text: request.text,
      cursor: request.cursor,
    })
  }

  const ensureSchema = () => {
    if (!workerAlive) {
      return
    }

    const schema = options.getState()
    if (
      cachedNodesById === schema.nodesById &&
      cachedRootIds === schema.rootIds &&
      cachedLoading === schema.loading &&
      cachedLoaded === schema.loaded
    ) {
      return
    }

    cachedNodesById = schema.nodesById
    cachedRootIds = schema.rootIds
    cachedLoading = schema.loading
    cachedLoaded = schema.loaded
    postRequest({
      type: "sync-schema",
      schema,
    })
  }

  worker.onmessage = (event: MessageEvent<SqlEditorResponse>) => {
    const message = event.data
    const handler = pending.get(message.id)
    if (!handler) {
      return
    }

    pending.delete(message.id)
    handler(message)
  }

  worker.onerror = (event) => {
    options.logger?.error(
      {
        workerPath,
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
      "sql-editor-bg-worker-adapter: worker error",
    )
    workerAlive = false
    clearPending()
  }

  worker.onmessageerror = (event) => {
    options.logger?.error({ workerPath, data: event.data }, "sql-editor-bg-worker-adapter: worker messageerror")
  }

  const analyze = (text: string, version: number) => {
    if (disposed || !workerAlive || version === latestAnalysisVersion) {
      return
    }

    latestAnalysisVersion = version
    const id = nextId
    nextId += 1
    latestAnalysisRequestId = id
    pending.set(id, (message) => {
      if (!message) {
        return
      }
      if (message.type !== "analyze") {
        return
      }
      if (message.id !== latestAnalysisRequestId) {
        return
      }

      setStatementAnalysisState(message.result)
    })
    postRequest({
      id,
      type: "analyze",
      text,
      version,
    })
  }

  const autocomplete: BufferAutocompleteProvider = {
    getCompletions: ({ text, cursor, signal }) => {
      if (disposed || signal.aborted) {
        return Promise.resolve(undefined)
      }

      if (!workerAlive) {
        return Promise.resolve(undefined)
      }

      ensureSchema()
      return new Promise<BufferAutocompleteResult | undefined>((resolve) => {
        const request: QueuedAutocomplete = {
          text,
          cursor,
          signal,
          resolve,
          onAbort: () => {
            if (queuedAutocomplete === request) {
              queuedAutocomplete = undefined
            }
            finishAutocomplete(request, undefined)
          },
          finished: false,
        }
        signal.addEventListener("abort", request.onAbort, { once: true })

        if (activeAutocomplete) {
          const previous = queuedAutocomplete
          queuedAutocomplete = request
          if (previous) {
            finishAutocomplete(previous, undefined)
          }
          return
        }

        queuedAutocomplete = request
        scheduleQueuedAutocomplete()
      })
    },
  }

  const statementAnalysis: StatementAnalysis = {
    current: statementAnalysisState,
    analyze,
  }

  const dispose = () => {
    if (disposed) {
      return
    }

    disposed = true
    workerAlive = false
    clearPending()
    worker.terminate()
  }

  return {
    autocomplete,
    statementAnalysis,
    dispose,
  }
}
