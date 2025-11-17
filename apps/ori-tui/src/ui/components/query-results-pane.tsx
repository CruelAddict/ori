import { TextAttributes } from "@opentui/core";
import { For, Show, createMemo } from "solid-js";
import type { QueryJob } from "@src/entities/query-job/providers/query-jobs-provider";

export interface QueryResultsPaneProps {
    job: QueryJob | undefined;
    visible: boolean;
}

export function QueryResultsPane(props: QueryResultsPaneProps) {
    const hasResults = createMemo(() => {
        const job = props.job;
        return job?.status === "success" && job?.result && job.result.rows.length > 0;
    });

    const maxColWidths = createMemo(() => {
        const job = props.job;
        if (!hasResults() || !job?.result) return [];

        const result = job.result;
        const widths = result.columns.map((col) => col.name.length);

        for (const row of result.rows) {
            for (let i = 0; i < row.length; i++) {
                const cellValue = String(row[i] ?? "NULL");
                widths[i] = Math.max(widths[i], cellValue.length);
            }
        }

        return widths.map((w) => Math.min(w, 50)); // cap at 50 chars
    });

    const formatCell = (value: any, width: number): string => {
        const str = value === null || value === undefined ? "NULL" : String(value);
        if (str.length > width) {
            return str.slice(0, width - 3) + "...";
        }
        return str.padEnd(width, " ");
    };

    return (
        <Show when={props.visible}>
            <box flexDirection="column" paddingLeft={1} paddingTop={1} paddingRight={1} flexShrink={0}>
                <text attributes={TextAttributes.BOLD}>Query Results</text>
                <box height={1} />

                <Show when={!props.job}>
                    <text attributes={TextAttributes.DIM}>No query executed yet</text>
                </Show>

                <Show when={props.job?.status === "running"}>
                    <text fg="yellow">Query is running...</text>
                </Show>

                <Show when={props.job?.status === "failed"}>
                    <box flexDirection="column">
                        <text fg="red">Query failed:</text>
                        <text fg="red">{props.job?.error || props.job?.message || "Unknown error"}</text>
                    </box>
                </Show>

                <Show when={hasResults()}>
                    <box flexDirection="column">
                        <box flexDirection="row">
                            <For each={props.job!.result!.columns}>
                                {(col, index) => (
                                    <>
                                        <text attributes={TextAttributes.BOLD} fg="cyan">
                                            {formatCell(col.name, maxColWidths()[index()])}
                                        </text>
                                        <Show when={index() < props.job!.result!.columns.length - 1}>
                                            <text attributes={TextAttributes.DIM}> | </text>
                                        </Show>
                                    </>
                                )}
                            </For>
                        </box>
                        <box flexDirection="row">
                            <For each={props.job!.result!.columns}>
                                {(_, index) => (
                                    <>
                                        <text attributes={TextAttributes.DIM}>
                                            {"-".repeat(maxColWidths()[index()])}
                                        </text>
                                        <Show when={index() < props.job!.result!.columns.length - 1}>
                                            <text attributes={TextAttributes.DIM}> | </text>
                                        </Show>
                                    </>
                                )}
                            </For>
                        </box>
                        <For each={props.job!.result!.rows}>
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
                            {props.job!.result!.rowCount} row{props.job!.result!.rowCount !== 1 ? "s" : ""}
                            {props.job!.result!.truncated ? " (truncated)" : ""}
                            {props.job!.durationMs ? ` • ${props.job!.durationMs}ms` : ""}
                        </text>
                    </box>
                </Show>

                <Show when={props.job?.status === "success" && !hasResults()}>
                    <text attributes={TextAttributes.DIM}>
                        Query completed successfully with no results
                        {props.job!.durationMs ? ` (${props.job!.durationMs}ms)` : ""}
                    </text>
                </Show>
            </box>
        </Show>
    );
}
