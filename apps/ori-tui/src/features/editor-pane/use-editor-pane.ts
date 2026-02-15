import { type QueryJob, useQueryJobs } from "@src/entities/query-job/providers/query-jobs-provider"
import { getConsoleFilePath, readConsoleQuery, writeConsoleQuery } from "@src/features/query-storage/query-storage"
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
  const queryJobs = useQueryJobs()

  const queryText = createMemo(() => queryJobs.getQueryText(options.resourceName()))
  const currentJob = createMemo(() => queryJobs.getJob(options.resourceName()))
  const isExecuting = createMemo(() => currentJob()?.status === "running")

  const onQueryChange = (text: string) => {
    queryJobs.setQueryText(options.resourceName(), text)
  }

  const executeQuery = async () => {
    const text = queryText()
    if (!text.trim()) {
      return
    }
    await queryJobs.executeQuery(options.resourceName(), text)
  }

  const cancelQuery = async () => {
    await queryJobs.cancelQuery(options.resourceName())
  }

  const saveQuery = (): boolean => {
    const text = queryText()
    return writeConsoleQuery(options.resourceName(), text)
  }

  onMount(() => {
    const name = options.resourceName()
    const existing = queryJobs.getQueryText(name)
    if (existing) {
      return
    }
    const saved = readConsoleQuery(name)
    if (saved) {
      queryJobs.setQueryText(name, saved)
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
