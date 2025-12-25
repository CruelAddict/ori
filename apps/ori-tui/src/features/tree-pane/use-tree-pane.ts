import { type SchemaTreeController, useGraphSnapshot, useSchemaTree } from "@entities/schema-tree";
import type { PaneFocusController } from "@src/features/connection/view/pane-types";
import type { Accessor } from "solid-js";
import { createSignal } from "solid-js";

export type TreePaneViewModel = {
  controller: SchemaTreeController;
  visible: Accessor<boolean>;
  isFocused: Accessor<boolean>;
  loading: Accessor<boolean>;
  error: Accessor<string | null>;
  toggleVisible: () => void;
  refreshGraph: () => Promise<void>;
};

type UseTreePaneOptions = {
  configurationName: Accessor<string>;
  focus: PaneFocusController;
};

export function useTreePane(options: UseTreePaneOptions): TreePaneViewModel {
  const { snapshot, loading, error, refresh } = useGraphSnapshot(options.configurationName);
  const controller = useSchemaTree(snapshot);
  const [visible, setVisible] = createSignal(true);

  const toggleVisible = () => {
    setVisible((prev) => {
      const next = !prev;
      if (next) {
        options.focus.focusSelf();
      } else if (options.focus.isFocused() && options.focus.focusFallback) {
        options.focus.focusFallback();
      }
      return next;
    });
  };

  const refreshGraph = async () => {
    await refresh();
  };

  return {
    controller,
    visible,
    isFocused: options.focus.isFocused,
    loading,
    error,
    toggleVisible,
    refreshGraph,
  };
}
