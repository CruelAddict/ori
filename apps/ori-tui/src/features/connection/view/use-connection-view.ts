import { useConfigurationByName } from "@src/entities/configuration/model/configuration-list-store";
import type { PaneFocusController } from "@src/features/connection/view/pane-types";
import { type EditorPaneViewModel, useEditorPane } from "@src/features/editor-pane/use-editor-pane";
import { type ResultsPaneViewModel, useResultsPane } from "@src/features/results-pane/use-results-pane";
import { type TreePaneViewModel, useTreePane } from "@src/features/tree-pane/use-tree-pane";
import type { Accessor } from "solid-js";
import { createMemo, createSignal } from "solid-js";

export type FocusPane = "tree" | "editor" | "results";

export type UseConnectionViewOptions = {
  configurationName: Accessor<string>;
};

export type ConnectionViewActions = {
  toggleTreeVisible: () => void;
  toggleResultsVisible: () => void;
  onQueryChange: (text: string) => void;
  executeQuery: () => Promise<void>;
  refreshGraph: () => Promise<void>;
  moveFocusLeft: () => void;
  moveFocusRight: () => void;
  moveFocusUp: () => void;
  moveFocusDown: () => void;
  openEditor: () => void;
  focusTree: () => void;
  focusEditor: () => void;
  setActive: (active: boolean) => void;
};

export type ConnectionViewModel = {
  title: Accessor<string>;
  editorOpen: Accessor<boolean>;
  treePane: TreePaneViewModel;
  editorPane: EditorPaneViewModel;
  resultsPane: ResultsPaneViewModel;
  actions: ConnectionViewActions;
};

const DEFAULT_PANE: FocusPane = "tree";

export function useConnectionView(options: UseConnectionViewOptions): ConnectionViewModel {
  const configuration = useConfigurationByName(options.configurationName);
  const title = createMemo(() => configuration()?.name ?? options.configurationName());
  const [focusedPane, setFocusedPane] = createSignal<FocusPane>(DEFAULT_PANE);
  const [editorOpen, setEditorOpen] = createSignal(false);
  const [isActive, setIsActive] = createSignal(true);
  let previousFocusedPane: FocusPane = DEFAULT_PANE;

  const focusPane = (pane: FocusPane) => {
    setFocusedPane((current) => {
      if (current === pane) {
        return current;
      }
      previousFocusedPane = current;
      return pane;
    });
  };

  const focusTree = () => focusPane("tree");
  const focusEditor = () => focusPane("editor");
  const focusResults = () => focusPane("results");

  const openEditor = () => {
    setEditorOpen(true);
    focusEditor();
  };

  const createFocusController = (pane: FocusPane, fallback?: () => void): PaneFocusController => ({
    isFocused: () => isActive() && focusedPane() === pane,
    focusSelf: () => focusPane(pane),
    focusFallback: fallback,
  });

  const treePane = useTreePane({
    configurationName: options.configurationName,
    focus: createFocusController("tree", () => focusPane(DEFAULT_PANE)),
  });

  const editorPane = useEditorPane({
    configurationName: options.configurationName,
    focus: createFocusController("editor"),
    unfocus: restorePreviousPaneFocus,
  });

  const resultsPane = useResultsPane({
    job: editorPane.currentJob,
    focus: createFocusController("results", () => focusPane(DEFAULT_PANE)),
  });

  function restorePreviousPaneFocus() {
    if (focusedPane() !== "editor") {
      return;
    }
    if (previousFocusedPane === "results" && resultsPane.visible()) {
      focusResults();
      return;
    }
    focusTree();
  }

  const hasResults = () => {
    const job = editorPane.currentJob();
    return !!(job?.result || job?.error);
  };

  // Can only leave tree if editor is open OR results are available
  const canLeaveTree = () => editorOpen() || hasResults();

  const moveFocusLeft = () => {
    if (focusedPane() === "editor" && treePane.visible()) {
      focusTree();
    } else if (focusedPane() === "results" && treePane.visible()) {
      focusTree();
    }
  };

  const moveFocusRight = () => {
    if (focusedPane() === "tree") {
      if (!canLeaveTree()) return;
      focusEditor();
    } else if (focusedPane() === "editor" && resultsPane.visible()) {
      focusResults();
    }
  };

  const moveFocusUp = () => {
    if (focusedPane() === "results") {
      focusEditor();
    }
  };

  const moveFocusDown = () => {
    if (focusedPane() === "editor" && resultsPane.visible()) {
      focusResults();
    }
  };

  const setActive = (active: boolean) => {
    setIsActive(active);
    if (!active) {
      return;
    }
    const pane = focusedPane();
    if (pane === "editor" && editorOpen()) {
      focusEditor();
      return;
    }
    if (pane === "results" && resultsPane.visible()) {
      focusResults();
      return;
    }
    focusTree();
  };

  const toggleResultsVisible = () => {
    if (!hasResults()) return;
    resultsPane.toggleVisible();
  };

  return {
    title,
    editorOpen,
    treePane,
    editorPane,
    resultsPane,
    actions: {
      toggleTreeVisible: treePane.toggleVisible,
      toggleResultsVisible,
      onQueryChange: editorPane.onQueryChange,
      executeQuery: editorPane.executeQuery,
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
  };
}
