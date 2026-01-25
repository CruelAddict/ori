import { useConfigurationByName } from "@src/entities/configuration/model/configuration-list-store"
import type { PaneFocusController } from "@src/features/connection/view/pane-types"
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

  const findPreviousVisiblePane = (exclude?: Pane | null) => {
    for (const pane of focusHistory) {
      if (pane === exclude) {
        continue
      }
      if (isPaneVisible(pane)) {
        return pane
      }
    }
    return null
  }

  const focusPane = (target: Pane | null) => {
    setFocusedPane((current) => {
      if (target === null) {
        return null
      }
      if (!isPaneVisible(target)) {
        const fallback = findPreviousVisiblePane(target)
        if (!fallback) {
          return null
        }
        target = fallback
      }
      if (current === target) {
        return current
      }
      updateFocusHistory(target)
      return target
    })
  }

  const focusTree = () => focusPane("tree")
  const focusEditor = () => focusPane("editor")
  const focusResults = () => focusPane("results")

  const focusPreviousVisiblePane = () => {
    const current = focusedPane()
    const next = findPreviousVisiblePane(current)
    if (next) {
      focusPane(next)
      return
    }
    if (current && isPaneVisible(current)) {
      focusPane(current)
      return
    }
    setFocusedPane(null)
  }

  const openEditor = () => {
    setPaneVisible("editor", true)
    focusEditor()
  }

  const createFocusController = (pane: Pane): PaneFocusController => ({
    isFocused: () => isActive() && focusedPane() === pane && isPaneVisible(pane),
    focusSelf: () => focusPane(pane),
  })

  treePane = useTreePane({
    configurationName: options.configurationName,
    focus: createFocusController("tree"),
    isVisible: () => isPaneVisible("tree"),
  })

  const editorPane = useEditorPane({
    configurationName: options.configurationName,
    focus: createFocusController("editor"),
    unfocus: focusPreviousVisiblePane,
    isVisible: () => isPaneVisible("editor"),
  })

  resultsPane = useResultsPane({
    job: editorPane.currentJob,
    focus: createFocusController("results"),
    isVisible: () => isPaneVisible("results"),
  })

  const hasResults = () => {
    const job = editorPane.currentJob()
    return !!(job?.result || job?.error)
  }

  const shouldShowResults = () => {
    const job = editorPane.currentJob()
    return !!(job?.result || job?.error || job?.status === "running")
  }

  // Can only leave tree if editor is open OR results are available
  const canLeaveTree = () => isPaneVisible("editor") || hasResults()

  const moveFocusLeft = () => {
    if (focusedPane() === "editor" && treePane.visible()) {
      focusTree()
    } else if (focusedPane() === "results" && treePane.visible()) {
      focusTree()
    }
  }

  const moveFocusRight = () => {
    if (focusedPane() === "tree") {
      if (!canLeaveTree()) return
      focusEditor()
    } else if (focusedPane() === "editor" && resultsPane.visible()) {
      focusResults()
    }
  }

  const moveFocusUp = () => {
    if (focusedPane() === "results") {
      focusEditor()
    }
  }

  const moveFocusDown = () => {
    if (focusedPane() === "editor" && resultsPane.visible()) {
      focusResults()
    }
  }

  const setActive = (active: boolean) => {
    setIsActive(active)
    if (!active) {
      return
    }
    const pane = focusedPane()
    if (pane && isPaneVisible(pane)) {
      focusPane(pane)
      return
    }
    focusPreviousVisiblePane()
  }

  const toggleResultsVisible = () => {
    if (!hasResults()) return
    const wasFocused = focusedPane() === "results"
    const next = !isPaneVisible("results")
    setPaneVisible("results", next)
    if (next) {
      focusResults()
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
      focusTree()
      return
    }
    if (wasFocused) {
      focusPreviousVisiblePane()
    }
  }

  createEffect(() => {
    if (shouldShowResults()) {
      setPaneVisible("results", true)
    }
  })

  return {
    title,
    treePane,
    editorPane,
    resultsPane,
    actions: {
      toggleTreeVisible,
      toggleResultsVisible,
      onQueryChange: editorPane.onQueryChange,
      executeQuery: editorPane.executeQuery,
      cancelQuery: editorPane.cancelQuery,
      refreshGraph: treePane.refreshGraph,
      moveFocusLeft,
      moveFocusRight,
      moveFocusUp,
      moveFocusDown,
      openEditor,
      focusTree,
      focusEditor,
      setActive,
    },
  }
}

export type ConnectionViewModel = ReturnType<typeof useConnectionView>
export type ConnectionViewActions = ConnectionViewModel["actions"]
