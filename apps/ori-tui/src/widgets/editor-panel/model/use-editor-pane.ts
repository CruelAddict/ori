import { getConsoleFilePath, readConsoleQuery, writeConsoleQuery } from "@shared/lib/resource-query-storage"
import { type QueryJob, useQuery } from "@src/entities/query/providers/query-provider"
import type { Accessor } from "solid-js"
import { createMemo, onMount } from "solid-js"

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

type UseEditorPaneOptions = {
  resourceName: Accessor<string>
  isFocused: Accessor<boolean>
  focusSelf: () => void
  unfocus: () => void
}

export function useEditorPane(options: UseEditorPaneOptions): EditorPaneViewModel {
  const query = useQuery()

  const queryText = createMemo(() => query.getQueryText(options.resourceName()))
  const currentJob = createMemo(() => query.getJob(options.resourceName()))
  const isExecuting = createMemo(() => currentJob()?.status === "running")

  const onQueryChange = (text: string) => {
    query.setQueryText(options.resourceName(), text)
  }

  const executeQuery = async () => {
    const text = queryText()
    if (!text.trim()) {
      return
    }
    await query.executeQuery(options.resourceName(), text)
  }

  const cancelQuery = async () => {
    await query.cancelQuery(options.resourceName())
  }

  const saveQuery = (): boolean => {
    const text = queryText()
    return writeConsoleQuery(options.resourceName(), text)
  }

  onMount(() => {
    const name = options.resourceName()
    const existing = query.getQueryText(name)
    if (existing) {
      return
    }
    const saved = readConsoleQuery(name)
    if (saved) {
      query.setQueryText(name, saved)
    }
  })

  const filePath = createMemo(() => getConsoleFilePath(options.resourceName()))

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
