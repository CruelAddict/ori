import { createMemo, createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import { useConfigurationByName } from "@src/entities/configuration/model/configuration-list-store";
import type { PaneFocusController } from "@src/features/connection/view/pane-types";
import { useTreePane, type TreePaneViewModel } from "@src/features/tree-pane/use-tree-pane";
import { useEditorPane, type EditorPaneViewModel } from "@src/features/editor-pane/use-editor-pane";
import { useResultsPane, type ResultsPaneViewModel } from "@src/features/results-pane/use-results-pane";

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

const DEFAULT_PANE: FocusPane = "tree";

export function useConnectionView(options: UseConnectionViewOptions): ConnectionViewModel {
    const configuration = useConfigurationByName(options.configurationName);
    const title = createMemo(() => configuration()?.name ?? options.configurationName());
    const [focusedPane, setFocusedPane] = createSignal<FocusPane>(DEFAULT_PANE);

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
        focus: createFocusController("tree", () => setFocusedPane(DEFAULT_PANE)),
    });

    const editorPane = useEditorPane({
        configurationName: options.configurationName,
        focus: createFocusController("editor"),
    });

    const resultsPane = useResultsPane({
        job: editorPane.currentJob,
        focus: createFocusController("results", () => setFocusedPane(DEFAULT_PANE)),
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
        "ctrl+s: save | ctrl+e: toggle tree | ctrl+r: toggle results | ctrl+x h/j/k/l: move focus | ctrl+x enter: execute";

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
