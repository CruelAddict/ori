import type { QueryJob, QueryUsecase } from "@usecase/query/usecase"
import { getScriptFilePath, readScript, writeScript } from "@usecase/script/storage"
import { buildLineStarts } from "@utils/line-offsets"
import type { Accessor } from "solid-js"
import { createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { resolveSqlQueryAtOffset, type SqlAnalysisSnapshot } from "../sql-analysis"
import type { SqlEditorSchemaState } from "../sql-editor-protocol"
import { resolveSqlQueryAtOffset as resolveSqlQueryAtOffsetFallback } from "../sql-statement-detector"

type Query = Pick<
  QueryUsecase,
  "subscribe" | "getState" | "setQueryText" | "executeQuery" | "failQuery" | "cancelQuery"
>

export type EditorPaneViewModel = {
  queryText: Accessor<string>
  currentJob: Accessor<QueryJob | undefined>
  isExecuting: Accessor<boolean>
  filePath: Accessor<string>
  getSchemaState: () => SqlEditorSchemaState
  subscribeSchemaState: (listener: () => void) => () => void
  onQueryChange: (text: string) => void
  executeQuery: (cursorOffset?: number, snapshot?: SqlAnalysisSnapshot) => Promise<void>
  cancelQuery: () => Promise<void>
  saveQuery: () => boolean
  isFocused: Accessor<boolean>
  focusSelf: () => void
  unfocus: () => void
}

type CreateVMOptions = {
  query: Query
  resourceName: Accessor<string>
  getSchemaState: () => SqlEditorSchemaState
  subscribeSchemaState: (listener: () => void) => () => void
  isFocused: Accessor<boolean>
  focusSelf: () => void
  unfocus: () => void
}

export function createVM(options: CreateVMOptions): EditorPaneViewModel {
  const [queryTextState, setQueryTextState] = createSignal(options.query.getState().queryText)
  const [jobState, setJobState] = createSignal(options.query.getState().job)

  const unsubscribe = options.query.subscribe(() => {
    setQueryTextState(options.query.getState().queryText)
    setJobState(options.query.getState().job)
  })

  onCleanup(() => {
    unsubscribe()
  })

  const queryText = createMemo(() => queryTextState())
  const currentJob = createMemo(() => jobState())
  const isExecuting = createMemo(() => currentJob()?.status === "running")

  const onQueryChange = (text: string) => {
    options.query.setQueryText(text)
  }

  const executeQuery = async (cursorOffset?: number, snapshot?: SqlAnalysisSnapshot) => {
    const text = queryText()
    if (!text.trim()) {
      return
    }

    if (cursorOffset === undefined) {
      await options.query.executeQuery(text)
      return
    }

    const lineStarts = buildLineStarts(text)
    const resolution =
      snapshot === undefined
        ? resolveSqlQueryAtOffsetFallback(text, lineStarts, cursorOffset)
        : resolveSqlQueryAtOffset(snapshot, lineStarts, text, cursorOffset)
    if (resolution.kind === "ambiguous") {
      options.query.failQuery(text, "cannot execute query when multiple queries share the cursor line")
      return
    }
    if (resolution.kind === "none") {
      return
    }

    const query = text.slice(resolution.query.start, resolution.query.end)
    if (!query.trim()) {
      return
    }

    await options.query.executeQuery(query)
  }

  const cancelQuery = async () => {
    await options.query.cancelQuery()
  }

  const saveQuery = (): boolean => {
    const text = queryText()
    return writeScript(options.resourceName(), text)
  }

  onMount(() => {
    const name = options.resourceName()
    const existing = options.query.getState().queryText
    if (existing) {
      return
    }
    const saved = readScript(name)
    if (saved) {
      options.query.setQueryText(saved)
    }
  })

  const filePath = createMemo(() => getScriptFilePath(options.resourceName()))

  return {
    queryText,
    currentJob,
    isExecuting,
    filePath,
    getSchemaState: options.getSchemaState,
    subscribeSchemaState: options.subscribeSchemaState,
    onQueryChange,
    executeQuery,
    cancelQuery,
    saveQuery,
    isFocused: options.isFocused,
    focusSelf: options.focusSelf,
    unfocus: options.unfocus,
  }
}
