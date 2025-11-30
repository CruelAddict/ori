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
    onBack: () => void;
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
    exit: () => void;
};

export type ConnectionViewModel = {
    title: Accessor<string>;
    helpText: Accessor<string>;
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

    const focusTree = () => setFocusedPane("tree");
    const focusEditor = () => setFocusedPane("editor");
    const focusResults = () => setFocusedPane("results");

    const openEditor = () => {
        setEditorOpen(true);
        focusEditor();
    };

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

    const toggleResultsVisible = () => {
        if (!hasResults()) return;
        resultsPane.toggleVisible();
    };

    const exit = () => {
        options.onBack();
    };

    const helpText = createMemo(() => {
        if (!editorOpen()) {
            return "q: open query console | ctrl+e: toggle tree";
        }
        return "ctrl+s: save | ctrl+e: toggle tree | ctrl+r: toggle results | ctrl+x h/j/k/l: move focus | ctrl+x enter: execute";
    });

    return {
        title,
        helpText,
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
            exit,
        },
    };
}
