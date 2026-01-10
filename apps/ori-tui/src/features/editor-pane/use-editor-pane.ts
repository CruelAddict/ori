import { type QueryJob, useQueryJobs } from "@src/entities/query-job/providers/query-jobs-provider"
import type { PaneFocusController } from "@src/features/connection/view/pane-types"
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
  saveQuery: () => boolean
  isFocused: Accessor<boolean>
  focusSelf: () => void
  unfocus: () => void
}

type UseEditorPaneOptions = {
  configurationName: Accessor<string>
  focus: PaneFocusController
  unfocus: () => void
}

export function useEditorPane(options: UseEditorPaneOptions): EditorPaneViewModel {
  const queryJobs = useQueryJobs()

  const queryText = createMemo(() => queryJobs.getQueryText(options.configurationName()))
  const currentJob = createMemo(() => queryJobs.getJob(options.configurationName()))
  const isExecuting = createMemo(() => currentJob()?.status === "running")

  const onQueryChange = (text: string) => {
    queryJobs.setQueryText(options.configurationName(), text)
  }

  const executeQuery = async () => {
    const text = queryText()
    if (!text.trim()) {
      return
    }
    await queryJobs.executeQuery(options.configurationName(), text)
  }

  const saveQuery = (): boolean => {
    const text = queryText()
    return writeConsoleQuery(options.configurationName(), text)
  }

  onMount(() => {
    const name = options.configurationName()
    const existing = queryJobs.getQueryText(name)
    if (existing) {
      return
    }
    const saved = readConsoleQuery(name)
    if (saved) {
      queryJobs.setQueryText(name, saved)
    }
  })

  const filePath = createMemo(() => getConsoleFilePath(options.configurationName()))

  return {
    queryText,
    currentJob,
    isExecuting,
    filePath,
    onQueryChange,
    executeQuery,
    saveQuery,
    isFocused: options.focus.isFocused,
    focusSelf: options.focus.focusSelf,
    unfocus: options.unfocus,
  }
}
