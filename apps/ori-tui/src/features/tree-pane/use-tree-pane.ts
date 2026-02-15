import { useResourceGraphSnapshot } from "@entities/schema-tree"
import { useTreePaneGraph } from "@widgets/tree-panel/model/tree-pane-graph"
import type { Accessor } from "solid-js"

export type TreePaneViewModel = {
  controller: ReturnType<typeof useTreePaneGraph>
  isFocused: Accessor<boolean>
  loading: Accessor<boolean>
  error: Accessor<string | null>
  focusSelf: () => void
  refreshGraph: () => Promise<void>
}

type UseTreePaneOptions = {
  resourceName: Accessor<string>
  isFocused: Accessor<boolean>
  focusSelf: () => void
}

export function useTreePane(options: UseTreePaneOptions): TreePaneViewModel {
  const { nodesById, rootIds, loading, error, refresh } = useResourceGraphSnapshot(options.resourceName)
  const controller = useTreePaneGraph(nodesById, rootIds)

  const refreshGraph = async () => {
    await refresh()
  }

  return {
    controller,
    isFocused: options.isFocused,
    focusSelf: options.focusSelf,
    loading,
    error,
    refreshGraph,
  }
}
