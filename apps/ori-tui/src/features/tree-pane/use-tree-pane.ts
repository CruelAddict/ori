import { useResourceGraphSnapshot, useSchemaTree } from "@entities/schema-tree"
import type { Accessor } from "solid-js"

export type TreePaneViewModel = {
  controller: ReturnType<typeof useSchemaTree>
  isFocused: Accessor<boolean>
  loading: Accessor<boolean>
  error: Accessor<string | null>
  focusSelf: () => void
  refreshGraph: () => Promise<void>
}

type UseTreePaneOptions = {
  configurationName: Accessor<string>
  isFocused: Accessor<boolean>
  focusSelf: () => void
}

export function useTreePane(options: UseTreePaneOptions): TreePaneViewModel {
  const { nodesById, rootIds, loading, error, refresh } = useResourceGraphSnapshot(options.configurationName)
  const controller = useSchemaTree(nodesById, rootIds)

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
