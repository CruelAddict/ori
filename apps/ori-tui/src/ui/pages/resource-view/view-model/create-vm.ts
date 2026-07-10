import type { Resource } from "@model/resource"
import { createVM as createEditorVM } from "@ui/widgets/editor-panel/view-model/create-vm"
import { createVM as createExplorerVM } from "@ui/widgets/explorer/view-model/create-vm"
import { createVM as createResultsVM } from "@ui/widgets/results-panel/view-model/create-vm"
import { buildBrowseQuery } from "@usecase/browse-query/usecase"
import type { ResourceIntrospectionUsecase } from "@usecase/introspection/usecase"
import type { QueryUsecase } from "@usecase/query/usecase"
import type { ResultSourceUsecase } from "@usecase/result-source/usecase"
import type { Accessor } from "solid-js"
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"

type CreateVMOptions = {
  resourceName: Accessor<string>
  resource: Accessor<Resource | undefined>
  query: QueryUsecase
  resultSource: ResultSourceUsecase
  introspection: Pick<ResourceIntrospectionUsecase, "subscribe" | "getState" | "load" | "refresh" | "ensureNodes">
}

export type Pane = "explorer" | "editor" | "results"

const DEFAULT_PANE: Pane = "explorer"

export function createVM(options: CreateVMOptions) {
  const title = createMemo(() => options.resource()?.name ?? options.resourceName())
  const [focusedPane, setFocusedPane] = createSignal<Pane | null>(DEFAULT_PANE)
  const [isActive, setIsActive] = createSignal(true)
  const focusHistory: Pane[] = [DEFAULT_PANE]
  const [visiblePanes, setVisiblePanes] = createSignal<Record<Pane, boolean>>({
    explorer: true,
    editor: false,
    results: false,
  })
  const [querySnapshot, setQuerySnapshot] = createSignal(options.query.getState())
  const [resultSourceSnapshot, setResultSourceSnapshot] = createSignal(options.resultSource.getState())

  const unsubscribeQuery = options.query.subscribe(() => {
    setQuerySnapshot(options.query.getState())
  })
  const unsubscribeResultSource = options.resultSource.subscribe(() => {
    setResultSourceSnapshot(options.resultSource.getState())
  })

  onCleanup(() => {
    unsubscribeQuery()
    unsubscribeResultSource()
  })

  const activeResultJob = createMemo(() => {
    const jobId = resultSourceSnapshot().current?.jobId
    if (!jobId) {
      return undefined
    }
    return querySnapshot().jobsById[jobId]
  })

  const isPaneVisible = (pane: Pane) => visiblePanes()[pane]
  const activeFocusedPane = createMemo(() => {
    if (!isActive()) {
      return null
    }
    const pane = focusedPane()
    if (!pane || !isPaneVisible(pane)) {
      return null
    }
    return pane
  })
  const setPaneVisible = (pane: Pane, next: boolean) => {
    setVisiblePanes((current) => {
      if (current[pane] === next) {
        return current
      }
      return { ...current, [pane]: next }
    })
  }

  const updateFocusHistory = (pane: Pane) => {
    const index = focusHistory.indexOf(pane)
    if (index === 0) {
      return
    }
    if (index > -1) {
      focusHistory.splice(index, 1)
    }
    focusHistory.unshift(pane)
  }

  const tryFocusPane = (target: Pane | null) => {
    if (target !== null && !isPaneVisible(target)) {
      return
    }
    setFocusedPane((current) => {
      if (target === null) {
        return null
      }
      if (current === target) {
        return current
      }
      updateFocusHistory(target)
      return target
    })
  }

  const focusPreviousVisiblePane = () => {
    const current = focusedPane()
    for (const pane of focusHistory) {
      if (pane === current) {
        continue
      }
      if (isPaneVisible(pane)) {
        tryFocusPane(pane)
        return
      }
    }
  }

  const openEditor = () => {
    setPaneVisible("editor", true)
    tryFocusPane("editor")
  }

  const paneFocusFuncs = (pane: Pane) => ({
    isFocused: () => isActive() && focusedPane() === pane && isPaneVisible(pane),
    focusSelf: () => tryFocusPane(pane),
  })

  const browseNode = async (node: Parameters<typeof buildBrowseQuery>[0]) => {
    if (activeResultJob()?.status === "running") {
      return
    }
    options.resultSource.executeQuery(buildBrowseQuery(node))
  }

  const explorer = createExplorerVM({
    introspection: options.introspection,
    browseNode,
    ...paneFocusFuncs("explorer"),
  })

  const editorPane = createEditorVM({
    query: options.query,
    executeQuery: options.resultSource.executeQuery,
    failQuery: options.resultSource.failQuery,
    resourceName: options.resourceName,
    getSchemaState: options.introspection.getState,
    subscribeSchemaState: options.introspection.subscribe,
    ...paneFocusFuncs("editor"),
    unfocus: focusPreviousVisiblePane,
  })

  const resultsPane = createResultsVM({
    job: activeResultJob,
    resultSource: options.resultSource,
    ...paneFocusFuncs("results"),
  })

  const setActive = (active: boolean) => {
    setIsActive(active)
    if (!active) {
      return
    }
    const pane = focusedPane()
    if (pane && isPaneVisible(pane)) {
      tryFocusPane(pane)
      return
    }
    focusPreviousVisiblePane()
  }

  const hasResultsPaneContent = () => {
    const job = activeResultJob()
    if (!job) {
      return false
    }
    if (job.result) {
      return true
    }
    return job.status === "failed" || job.status === "success"
  }

  const toggleResultsVisible = () => {
    if (!hasResultsPaneContent()) return
    const wasFocused = focusedPane() === "results"
    const next = !isPaneVisible("results")
    setPaneVisible("results", next)
    if (next) {
      tryFocusPane("results")
      return
    }
    if (wasFocused) {
      focusPreviousVisiblePane()
    }
  }

  const toggleExplorerVisible = () => {
    const wasFocused = focusedPane() === "explorer"
    const next = !isPaneVisible("explorer")
    setPaneVisible("explorer", next)
    if (next) {
      tryFocusPane("explorer")
      return
    }
    if (wasFocused) {
      focusPreviousVisiblePane()
    }
  }

  createEffect(() => {
    if (hasResultsPaneContent()) {
      setPaneVisible("results", true)
    }
  })

  const cancelQuery = async () => {
    const job = activeResultJob()
    if (job?.status !== "running") {
      return
    }
    await options.query.cancelQuery(job.jobId)
  }

  return {
    title,
    explorer,
    editorPane,
    resultsPane,
    focusedPane: activeFocusedPane,
    visiblePanes,
    isPaneVisible,
    actions: {
      toggleExplorerVisible,
      toggleResultsVisible,
      onQueryChange: editorPane.onQueryChange,
      executeQuery: editorPane.executeQuery,
      cancelQuery,
      refreshGraph: explorer.refreshGraph,
      moveFocusLeft: () => {
        tryFocusPane("explorer")
      },
      moveFocusRight: () => {
        if (focusedPane() !== "explorer") return
        if (isPaneVisible("editor")) tryFocusPane("editor")
        else tryFocusPane("results")
      },
      moveFocusUp: () => {
        if (focusedPane() === "results") tryFocusPane("editor")
      },
      moveFocusDown: () => {
        if (focusedPane() === "editor") tryFocusPane("results")
      },
      openEditor,
      focusPane: tryFocusPane,
      setActive,
    },
  }
}
