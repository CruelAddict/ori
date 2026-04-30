import type { BufferAutocompleteProvider, BufferAutocompleteResult } from "@ui/components/buffer"
import type { Logger } from "pino"
import { type Accessor, createSignal } from "solid-js"
import type { SqlEditorSchemaState, SqlEditorWorkerRequest, SqlEditorWorkerResponse } from "./sql-editor-worker-types"
import type { SqlDocumentAnalysis } from "./sql-statement-detector"

export type SqlEditorAnalysis = SqlDocumentAnalysis & {
  version: number
}

export type SqlEditorBackgroundWorker = {
  autocomplete: BufferAutocompleteProvider
  analysis: Accessor<SqlEditorAnalysis | undefined>
  requestAnalysis: (text: string, version: number) => void
  dispose: () => void
}

type CreateSqlEditorBackgroundWorkerOptions = {
  getState: () => SqlEditorSchemaState
  logger?: Logger
}

export function createSqlEditorBackgroundWorker(
  options: CreateSqlEditorBackgroundWorkerOptions,
): SqlEditorBackgroundWorker {
  const [analysis, setAnalysis] = createSignal<SqlEditorAnalysis>()
  const workerPath = import.meta.url === "file:///$bunfs/root/src/index.js"
    ? "/$bunfs/root/src/ui/widgets/editor-panel/sql-editor.worker.js"
    : new URL("./sql-editor.worker.ts", import.meta.url).href
  const worker = new Worker(workerPath)
  const pending = new Map<number, (message: SqlEditorWorkerResponse | undefined) => void>()
  let nextId = 0
  let disposed = false
  let workerAlive = true
  let cachedNodesById: SqlEditorSchemaState["nodesById"] | undefined
  let cachedRootIds: SqlEditorSchemaState["rootIds"] | undefined
  let cachedLoading: SqlEditorSchemaState["loading"] | undefined
  let cachedLoaded: SqlEditorSchemaState["loaded"] | undefined
  let latestAnalysisRequestId = -1
  let latestAnalysisVersion = -1

  const clearPending = () => {
    for (const handler of pending.values()) {
      handler(undefined)
    }
    pending.clear()
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
    const message: SqlEditorWorkerRequest = {
      type: "sync-schema",
      schema,
    }
    worker.postMessage(message)
  }

  worker.onmessage = (event: MessageEvent<SqlEditorWorkerResponse>) => {
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
      "sql-editor-background-worker: worker error",
    )
    workerAlive = false
    clearPending()
  }

  worker.onmessageerror = (event) => {
    options.logger?.error({ workerPath, data: event.data }, "sql-editor-background-worker: worker messageerror")
  }

  const requestAnalysis = (text: string, version: number) => {
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

      setAnalysis(message.result)
    })
    const payload: SqlEditorWorkerRequest = {
      id,
      type: "analyze",
      text,
      version,
    }
    worker.postMessage(payload)
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
      const id = nextId
      nextId += 1
      return new Promise<BufferAutocompleteResult | undefined>((resolve) => {
        const onAbort = () => {
          pending.delete(id)
          resolve(undefined)
        }
        signal.addEventListener("abort", onAbort, { once: true })
        pending.set(id, (message) => {
          signal.removeEventListener("abort", onAbort)
          if (!message) {
            resolve(undefined)
            return
          }
          if (message.type !== "autocomplete") {
            resolve(undefined)
            return
          }
          if (signal.aborted) {
            resolve(undefined)
            return
          }

          resolve(message.result)
        })
        const payload: SqlEditorWorkerRequest = {
          id,
          type: "autocomplete",
          text,
          cursor,
        }
        worker.postMessage(payload)
      })
    },
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
    analysis,
    requestAnalysis,
    dispose,
  }
}
