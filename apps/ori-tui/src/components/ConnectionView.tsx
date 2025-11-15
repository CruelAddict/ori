import { TextAttributes } from "@opentui/core";
import type { KeyEvent } from "@opentui/core";
import { For, Show, createMemo, createSignal, createEffect } from "solid-js";
import { useGraphSnapshot } from "@src/lib/useGraphSnapshot";
import { useSchemaTree } from "@src/lib/schemaTree";
import { useConfigurationByName } from "@src/core/stores/configurationListStore";
import { useQueryJobs } from "@src/providers/queryJobs";
import { QueryEditor } from "@src/components/QueryEditor";
import { QueryResultsPane } from "@src/components/QueryResultsPane";
import { KeyScope } from "@src/core/services/keyScopes";

export interface ConnectionViewProps {
    configurationName: string;
    onBack: () => void;
}

type FocusPane = "tree" | "editor" | "results";

export function ConnectionView(props: ConnectionViewProps) {
    const configuration = useConfigurationByName(() => props.configurationName);
    const { snapshot, loading, error, refresh } = useGraphSnapshot(() => props.configurationName);
    const tree = useSchemaTree(snapshot);
    const queryJobs = useQueryJobs();

    const title = createMemo(() => configuration()?.name ?? props.configurationName);
    const [treeVisible, setTreeVisible] = createSignal(true);
    const [resultsVisible, setResultsVisible] = createSignal(false);
    const [focusedPane, setFocusedPane] = createSignal<FocusPane>("tree");

    const queryText = createMemo(() => queryJobs.getQueryText(props.configurationName));
    const currentJob = createMemo(() => queryJobs.getJob(props.configurationName));
    const isExecuting = createMemo(() => currentJob()?.status === "running");

    // Auto-show results pane when query completes successfully
    createEffect(() => {
        const job = currentJob();
        if (job?.status === "success" && job.result) {
            setResultsVisible(true);
        }
    });

    const handleExit = () => {
        props.onBack();
    };

    const handleQueryChange = (text: string) => {
        queryJobs.setQueryText(props.configurationName, text);
    };

    const handleExecuteQuery = async () => {
        const text = queryText();
        if (text.trim()) {
            await queryJobs.executeQuery(props.configurationName, text);
        }
    };

    const toggleTreeVisible = () => {
        setTreeVisible((prev) => {
            const newValue = !prev;
            if (newValue) {
                // Opening tree - focus it
                setFocusedPane("tree");
            } else if (focusedPane() === "tree") {
                // Closing tree while it's focused - focus editor
                setFocusedPane("editor");
            }
            return newValue;
        });
    };

    const toggleResultsVisible = () => {
        setResultsVisible((prev) => {
            const newValue = !prev;
            if (newValue) {
                // Opening results - focus it
                setFocusedPane("results");
            } else if (focusedPane() === "results") {
                // Closing results while it's focused - focus editor
                setFocusedPane("editor");
            }
            return newValue;
        });
    };

    const moveFocusLeft = () => {
        if (focusedPane() === "editor" && treeVisible()) {
            setFocusedPane("tree");
        } else if (focusedPane() === "results" && treeVisible()) {
            setFocusedPane("tree");
        }
    };

    const moveFocusRight = () => {
        if (focusedPane() === "tree") {
            setFocusedPane("editor");
        } else if (focusedPane() === "editor" && resultsVisible()) {
            setFocusedPane("results");
        }
    };

    const moveFocusUp = () => {
        if (focusedPane() === "results") {
            setFocusedPane("editor");
        }
    };

    const moveFocusDown = () => {
        if (focusedPane() === "editor" && resultsVisible()) {
            setFocusedPane("results");
        }
    };


    const handleTreeDown = () => {
        if (focusedPane() === "tree") {
            tree.moveSelection(1);
        }
    };

    const handleTreeUp = () => {
        if (focusedPane() === "tree") {
            tree.moveSelection(-1);
        }
    };

    const handleTreeRight = () => {
        if (focusedPane() === "tree") {
            tree.focusFirstChild();
        }
    };

    const handleTreeLeft = () => {
        if (focusedPane() === "tree") {
            tree.collapseCurrentOrParent();
        }
    };

    const keyBindings = createMemo(() => [
        {
            pattern: "escape",
            handler: handleExit,
            preventDefault: true,
        },
        {
            pattern: "backspace",
            handler: handleExit,
            when: () => focusedPane() !== "editor",
            preventDefault: true,
        },
        {
            pattern: "ctrl+[",
            handler: handleExit,
            preventDefault: true,
        },
        {
            pattern: "ctrl+e",
            handler: toggleTreeVisible,
            preventDefault: true,
        },
        {
            pattern: "ctrl+r",
            handler: toggleResultsVisible,
            preventDefault: true,
        },
        {
            pattern: "ctrl+shift+r",
            handler: () => {
                void refresh();
            },
            preventDefault: true,
        },
        // Tree navigation (only when tree is focused)
        {
            pattern: "down",
            handler: handleTreeDown,
            when: () => focusedPane() === "tree",
            preventDefault: true,
        },
        {
            pattern: "j",
            handler: handleTreeDown,
            when: () => focusedPane() === "tree",
            preventDefault: true,
        },
        {
            pattern: "up",
            handler: handleTreeUp,
            when: () => focusedPane() === "tree",
            preventDefault: true,
        },
        {
            pattern: "k",
            handler: handleTreeUp,
            when: () => focusedPane() === "tree",
            preventDefault: true,
        },
        {
            pattern: "right",
            handler: handleTreeRight,
            when: () => focusedPane() === "tree",
            preventDefault: true,
        },
        {
            pattern: "l",
            handler: handleTreeRight,
            when: () => focusedPane() === "tree",
            preventDefault: true,
        },
        {
            pattern: "left",
            handler: handleTreeLeft,
            when: () => focusedPane() === "tree",
            preventDefault: true,
        },
        {
            pattern: "h",
            handler: handleTreeLeft,
            when: () => focusedPane() === "tree",
            preventDefault: true,
        },
        // Leader key commands for pane navigation and execution
        {
            pattern: "h",
            mode: "leader" as const,
            handler: () => moveFocusLeft(),
            when: () => treeVisible(),
            preventDefault: true,
        },
        {
            pattern: "l",
            mode: "leader" as const,
            handler: () => moveFocusRight(),
            preventDefault: true,
        },
        {
            pattern: "j",
            mode: "leader" as const,
            handler: () => moveFocusDown(),
            when: () => resultsVisible(),
            preventDefault: true,
        },
        {
            pattern: "k",
            mode: "leader" as const,
            handler: () => moveFocusUp(),
            when: () => focusedPane() === "results",
            preventDefault: true,
        },
        {
            pattern: "enter",
            mode: "leader" as const,
            handler: () => {
                void handleExecuteQuery();
            },
            preventDefault: true,
        },
    ]);

    return (
        <KeyScope id="connection-view" bindings={keyBindings}>
            <box flexDirection="column" flexGrow={1} padding={1}>
                <text attributes={TextAttributes.BOLD}>Connection</text>
                <text attributes={TextAttributes.DIM}>{title()}</text>
                <box height={1} />

                <box flexDirection="row" flexGrow={1}>
                    {/* Left pane: Schema Tree */}
                    <Show when={treeVisible()}>
                        <box
                            flexDirection="column"
                            width={40}
                            flexShrink={0}
                            borderStyle="single"
                            borderColor={focusedPane() === "tree" ? "cyan" : "gray"}
                        >
                            <box padding={1} flexDirection="column" flexGrow={1}>
                                <Show when={loading()}>
                                    <text>Loading schema graph...</text>
                                </Show>
                                <Show when={!loading() && error()}>
                                    {(message: () => any) => <text fg="red">Failed to load graph: {message()}</text>}
                                </Show>
                                <Show when={!loading() && !error()}>
                                    <box flexDirection="column">
                                        <For each={tree.rows()}>
                                            {(row) => {
                                                const isSelected = () => tree.selectedId() === row.id;
                                                const toggleGlyph = row.entity.hasChildren
                                                    ? row.isExpanded
                                                        ? "[-]"
                                                        : "[+]"
                                                    : "   ";
                                                const fg = () => (isSelected() ? "cyan" : undefined);
                                                const attrs = () => (isSelected() ? TextAttributes.BOLD : TextAttributes.NONE);
                                                return (
                                                    <box flexDirection="row" paddingLeft={row.depth * 2}>
                                                        <text fg={fg()} attributes={attrs()}>
                                                            {isSelected() ? "> " : "  "}
                                                            {toggleGlyph} {row.entity.icon} {row.entity.label}
                                                        </text>
                                                        {row.entity.description && (
                                                            <text attributes={TextAttributes.DIM}> {row.entity.description}</text>
                                                        )}
                                                        {row.entity.badges && <text fg="cyan"> {row.entity.badges}</text>}
                                                    </box>
                                                );
                                            }}
                                        </For>
                                        <Show when={tree.rows().length === 0}>
                                            <text attributes={TextAttributes.DIM}>Graph is empty. Try refreshing later.</text>
                                        </Show>
                                    </box>
                                </Show>
                            </box>
                        </box>
                    </Show>

                    {/* Right pane: Query Editor and Results */}
                    <box flexDirection="column" flexGrow={1} marginLeft={treeVisible() ? 1 : 0}>
                        {/* Query Editor */}
                        <box
                            flexDirection="column"
                            flexGrow={resultsVisible() ? 1 : 1}
                            borderStyle="single"
                            borderColor={focusedPane() === "editor" ? "cyan" : "gray"}
                        >
                            <QueryEditor
                                configurationName={props.configurationName}
                                value={queryText()}
                                onChange={handleQueryChange}
                                onExecute={handleExecuteQuery}
                                executing={isExecuting()}
                                focused={focusedPane() === "editor"}
                            />
                        </box>

                        {/* Query Results */}
                        <Show when={resultsVisible()}>
                            <box height={1} />
                            <box
                                flexDirection="column"
                                flexGrow={1}
                                borderStyle="single"
                                borderColor={focusedPane() === "results" ? "cyan" : "gray"}
                            >
                                <QueryResultsPane
                                    job={currentJob()}
                                    visible={resultsVisible()}
                                />
                            </box>
                        </Show>
                    </box>
                </box>

                <box height={1} />
                <text attributes={TextAttributes.DIM}>
                    Ctrl+E: toggle tree | Ctrl+R: toggle results | Ctrl+Shift+R: refresh | Ctrl+X then H/J/K/L: move focus | Ctrl+X then Enter: execute | Esc: back
                </text>
            </box>
        </KeyScope>
    );
}
