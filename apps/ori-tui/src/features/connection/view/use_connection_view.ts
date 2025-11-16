import { createMemo, createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import { useConfigurationByName } from "@src/entities/configuration/model/configuration_list_store";
import type { PaneFocusController } from "@src/features/connection/view/pane_types";
import { useTreePane, type TreePaneViewModel } from "@src/features/tree-pane/use_tree_pane";
import { useEditorPane, type EditorPaneViewModel } from "@src/features/editor-pane/use_editor_pane";
import { useResultsPane, type ResultsPaneViewModel } from "@src/features/results-pane/use_results_pane";

export type FocusPane = "tree" | "editor" | "results";

export interface UseConnectionViewOptions {
    configurationName: Accessor<string>;
    onBack: () => void;
}

export interface ConnectionViewActions {
    toggleTreeVisible: () => void;
    toggleResultsVisible: () => void;
    onQueryChange: (text: string) => void;
    executeQuery: () => Promise<void>;
    refreshGraph: () => Promise<void>;
    moveFocusLeft: () => void;
    moveFocusRight: () => void;
    moveFocusUp: () => void;
    moveFocusDown: () => void;
    exit: () => void;
}

export interface ConnectionViewModel {
    title: Accessor<string>;
    helpText: string;
    treePane: TreePaneViewModel;
    editorPane: EditorPaneViewModel;
    resultsPane: ResultsPaneViewModel;
    actions: ConnectionViewActions;
}

export function useConnectionView(options: UseConnectionViewOptions): ConnectionViewModel {
    const configuration = useConfigurationByName(options.configurationName);
    const title = createMemo(() => configuration()?.name ?? options.configurationName());
    const [focusedPane, setFocusedPane] = createSignal<FocusPane>("tree");

    const focusTree = () => setFocusedPane("tree");
    const focusEditor = () => setFocusedPane("editor");
    const focusResults = () => setFocusedPane("results");

    const createFocusController = (pane: FocusPane, fallback?: () => void): PaneFocusController => ({
        isFocused: () => focusedPane() === pane,
        focusSelf: () => setFocusedPane(pane),
        focusFallback: fallback,
    });

    const treePane = useTreePane({
        configurationName: options.configurationName,
        focus: createFocusController("tree", () => setFocusedPane("editor")),
    });

    const editorPane = useEditorPane({
        configurationName: options.configurationName,
        focus: createFocusController("editor"),
    });

    const resultsPane = useResultsPane({
        job: editorPane.currentJob,
        focus: createFocusController("results", () => setFocusedPane("editor")),
    });

    const moveFocusLeft = () => {
        if (focusedPane() === "editor" && treePane.visible()) {
            focusTree();
        } else if (focusedPane() === "results" && treePane.visible()) {
            focusTree();
        }
    };

    const moveFocusRight = () => {
        if (focusedPane() === "tree") {
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

    const exit = () => {
        options.onBack();
    };

    const helpText =
        "Ctrl+E: toggle tree | Ctrl+R: toggle results | Ctrl+Shift+R: refresh | Ctrl+X then H/J/K/L: move focus | Ctrl+X then Enter: execute | Esc: back";

    return {
        title,
        helpText,
        treePane,
        editorPane,
        resultsPane,
        actions: {
            toggleTreeVisible: treePane.toggleVisible,
            toggleResultsVisible: resultsPane.toggleVisible,
            onQueryChange: editorPane.onQueryChange,
            executeQuery: editorPane.executeQuery,
            refreshGraph: treePane.refreshGraph,
            moveFocusLeft,
            moveFocusRight,
            moveFocusUp,
            moveFocusDown,
            exit,
        },
    };
}
