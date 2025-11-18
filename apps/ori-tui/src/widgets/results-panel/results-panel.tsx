import { For, Show, createMemo } from "solid-js";
import { TextAttributes } from "@opentui/core";
import { KeyScope, type KeyBinding } from "@src/core/services/key-scopes";
import type { ResultsPaneViewModel } from "@src/features/results-pane/use-results-pane";

const RESULTS_SCOPE_ID = "connection-view.results";

export interface ResultsPanelProps {
    viewModel: ResultsPaneViewModel;
}

export function ResultsPanel(props: ResultsPanelProps) {
    const pane = props.viewModel;
    const job = () => pane.job();

    const bindings: KeyBinding[] = [];
    const enabled = () => pane.visible() && pane.isFocused();

    const hasResults = createMemo(() => {
        const current = job();
        return current?.status === "success" && current?.result && current.result.rows.length > 0;
    });

    const maxColWidths = createMemo(() => {
        const current = job();
        if (!hasResults() || !current?.result) return [];
        const result = current.result;
        const widths = result.columns.map((column) => column.name.length);
        for (const row of result.rows) {
            for (let i = 0; i < row.length; i++) {
                const cellValue = String(row[i] ?? "NULL");
                widths[i] = Math.max(widths[i], cellValue.length);
            }
        }
        return widths.map((width) => Math.min(width, 50));
    });

    const formatCell = (value: unknown, width: number): string => {
        const str = value === null || value === undefined ? "NULL" : String(value);
        if (str.length > width) {
            return str.slice(0, width - 3) + "...";
        }
        return str.padEnd(width, " ");
    };

    return (
        <Show when={pane.visible()}>
            <KeyScope id={RESULTS_SCOPE_ID} bindings={bindings} enabled={enabled}>
                <box
                    flexDirection="column"
                    flexGrow={1}
                    borderStyle="single"
                    borderColor={pane.isFocused() ? "cyan" : "gray"}
                >
                    <box flexDirection="column" paddingLeft={1} paddingTop={1} paddingRight={1} flexShrink={0}>
                        <text attributes={TextAttributes.BOLD}>Query Results</text>
                        <box height={1} />

                        <Show when={!job()}>
                            <text attributes={TextAttributes.DIM}>No query executed yet</text>
                        </Show>

                        <Show when={job()?.status === "running"}>
                            <text fg="yellow">Query is running...</text>
                        </Show>

                        <Show when={job()?.status === "failed"}>
                            <box flexDirection="column">
                                <text fg="red">Query failed:</text>
                                <text fg="red">{job()?.error || job()?.message || "Unknown error"}</text>
                            </box>
                        </Show>

                        <Show when={hasResults()}>
                            <box flexDirection="column">
                                <box flexDirection="row">
                                    <For each={job()!.result!.columns}>
                                        {(column, index) => (
                                            <>
                                                <text attributes={TextAttributes.BOLD} fg="cyan">
                                                    {formatCell(column.name, maxColWidths()[index()])}
                                                </text>
                                                <Show when={index() < job()!.result!.columns.length - 1}>
                                                    <text attributes={TextAttributes.DIM}> | </text>
                                                </Show>
                                            </>
                                        )}
                                    </For>
                                </box>
                                <box flexDirection="row">
                                    <For each={job()!.result!.columns}>
                                        {(_, index) => (
                                            <>
                                                <text attributes={TextAttributes.DIM}>
                                                    {"-".repeat(maxColWidths()[index()])}
                                                </text>
                                                <Show when={index() < job()!.result!.columns.length - 1}>
                                                    <text attributes={TextAttributes.DIM}> | </text>
                                                </Show>
                                            </>
                                        )}
                                    </For>
                                </box>
                                <For each={job()!.result!.rows}>
                                    {(row) => (
                                        <box flexDirection="row">
                                            <For each={row}>
                                                {(cell, index) => (
                                                    <>
                                                        <text>
                                                            {formatCell(cell, maxColWidths()[index()])}
                                                        </text>
                                                        <Show when={index() < row.length - 1}>
                                                            <text attributes={TextAttributes.DIM}> | </text>
                                                        </Show>
                                                    </>
                                                )}
                                            </For>
                                        </box>
                                    )}
                                </For>
                                <box height={1} />
                                <text attributes={TextAttributes.DIM}>
                                    {job()!.result!.rowCount} row{job()!.result!.rowCount !== 1 ? "s" : ""}
                                    {job()!.result!.truncated ? " (truncated)" : ""}
                                    {job()!.durationMs ? ` • ${job()!.durationMs}ms` : ""}
                                </text>
                            </box>
                        </Show>

                        <Show when={job()?.status === "success" && !hasResults()}>
                            <text attributes={TextAttributes.DIM}>
                                Query completed successfully with no results
                                {job()!.durationMs ? ` (${job()!.durationMs}ms)` : ""}
                            </text>
                        </Show>
                    </box>
                </box>
            </KeyScope>
        </Show>
    );
}
