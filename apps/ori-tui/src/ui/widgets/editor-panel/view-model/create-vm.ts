import type { QueryJob, QueryUsecase } from "@usecase/query/usecase"
import { getScriptFilePath, readScript, writeScript } from "@usecase/script/storage"
import type { Accessor } from "solid-js"
import { createMemo, createSignal, onCleanup, onMount } from "solid-js"

type Query = Pick<QueryUsecase, "subscribe" | "getState" | "setQueryText" | "executeQuery" | "cancelQuery">

export type EditorPaneViewModel = {
  queryText: Accessor<string>
  currentJob: Accessor<QueryJob | undefined>
  isExecuting: Accessor<boolean>
  filePath: Accessor<string>
  onQueryChange: (text: string) => void
  executeQuery: () => Promise<void>
  cancelQuery: () => Promise<void>
  saveQuery: () => boolean
  isFocused: Accessor<boolean>
  focusSelf: () => void
  unfocus: () => void
}

type CreateVMOptions = {
  query: Query
  resourceName: Accessor<string>
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

  const executeQuery = async () => {
    const text = queryText()
    if (!text.trim()) {
      return
    }
    await options.query.executeQuery(text)
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
    onQueryChange,
    executeQuery,
    cancelQuery,
    saveQuery,
    isFocused: options.isFocused,
    focusSelf: options.focusSelf,
    unfocus: options.unfocus,
  }
}
