import { useResourceGraphSnapshot, useSchemaTree } from "@entities/schema-tree"
import type { PaneFocusController } from "@src/features/connection/view/pane-types"
import type { Accessor } from "solid-js"

export type TreePaneViewModel = {
  controller: ReturnType<typeof useSchemaTree>
  visible: Accessor<boolean>
  isFocused: Accessor<boolean>
  loading: Accessor<boolean>
  error: Accessor<string | null>
  focusSelf: () => void
  refreshGraph: () => Promise<void>
}

type UseTreePaneOptions = {
  configurationName: Accessor<string>
  focus: PaneFocusController
  isVisible: Accessor<boolean>
}

export function useTreePane(options: UseTreePaneOptions): TreePaneViewModel {
  const { snapshot, loading, error, refresh } = useResourceGraphSnapshot(options.configurationName)
  const controller = useSchemaTree(snapshot)

  const refreshGraph = async () => {
    await refresh()
  }

  return {
    controller,
    visible: options.isVisible,
    isFocused: options.focus.isFocused,
    focusSelf: options.focus.focusSelf,
    loading,
    error,
    refreshGraph,
  }
}
