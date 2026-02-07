import { useConfigurationByName } from "@src/entities/configuration/model/configuration-list-store"
import { useEditorPane } from "@src/features/editor-pane/use-editor-pane"
import { useResultsPane } from "@src/features/results-pane/use-results-pane"
import { useTreePane } from "@src/features/tree-pane/use-tree-pane"
import type { Accessor } from "solid-js"
import { createEffect, createMemo, createSignal } from "solid-js"

export type Pane = "tree" | "editor" | "results"

export type UseConnectionViewOptions = {
  configurationName: Accessor<string>
}

const DEFAULT_PANE: Pane = "tree"

export function useConnectionView(options: UseConnectionViewOptions) {
  const configuration = useConfigurationByName(options.configurationName)
  const title = createMemo(() => configuration()?.name ?? options.configurationName())
  const [focusedPane, setFocusedPane] = createSignal<Pane | null>(DEFAULT_PANE)
  const [isActive, setIsActive] = createSignal(true)
  const focusHistory: Pane[] = [DEFAULT_PANE]
  const [visiblePanes, setVisiblePanes] = createSignal<Record<Pane, boolean>>({
    tree: true,
    editor: false,
    results: false,
  })

  let treePane: ReturnType<typeof useTreePane>
  let resultsPane: ReturnType<typeof useResultsPane>

  const isPaneVisible = (pane: Pane) => visiblePanes()[pane]
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

  treePane = useTreePane({
    configurationName: options.configurationName,
    ...paneFocusFuncs("tree"),
  })

  const editorPane = useEditorPane({
    configurationName: options.configurationName,
    ...paneFocusFuncs("editor"),
    unfocus: focusPreviousVisiblePane,
  })

  resultsPane = useResultsPane({
    job: editorPane.currentJob,
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
    const job = editorPane.currentJob()
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

  const toggleTreeVisible = () => {
    const wasFocused = focusedPane() === "tree"
    const next = !isPaneVisible("tree")
    setPaneVisible("tree", next)
    if (next) {
      tryFocusPane("tree")
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

  return {
    title,
    treePane,
    editorPane,
    resultsPane,
    isPaneVisible,
    actions: {
      toggleTreeVisible,
      toggleResultsVisible,
      onQueryChange: editorPane.onQueryChange,
      executeQuery: editorPane.executeQuery,
      cancelQuery: editorPane.cancelQuery,
      refreshGraph: treePane.refreshGraph,
      moveFocusLeft: () => {
        tryFocusPane("tree")
      },
      moveFocusRight: () => {
        if (focusedPane() !== "tree") return
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
