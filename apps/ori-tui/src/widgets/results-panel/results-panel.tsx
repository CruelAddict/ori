import { useTheme } from "@app/providers/theme";
import { TextAttributes } from "@opentui/core";
import { type KeyBinding, KeyScope } from "@src/core/services/key-scopes";
import type { ResultsPaneViewModel } from "@src/features/results-pane/use-results-pane";
import { createMemo, For, Show } from "solid-js";

export type ResultsPanelProps = {
  viewModel: ResultsPaneViewModel;
};

export function ResultsPanel(props: ResultsPanelProps) {
  const pane = props.viewModel;
  const job = () => pane.job();
  const { theme } = useTheme();
  const palette = theme;

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
      return `${str.slice(0, width - 3)}...`;
    }
    return str.padEnd(width, " ");
  };

  return (
    <Show when={pane.visible()}>
      <KeyScope
        bindings={bindings}
        enabled={enabled}
      >
        <box
          flexDirection="column"
          flexGrow={1}
          border={["top"]}
          borderColor={palette().backgroundElement}
          marginBottom={1}
        >
          <box
            flexDirection="column"
            paddingLeft={1}
            paddingTop={1}
            paddingRight={1}
            flexShrink={0}
          >
            <Show when={!job()}>
              <text
                attributes={TextAttributes.DIM}
                fg={palette().textMuted}
              >
                No query executed yet
              </text>
            </Show>

            <Show when={job()?.status === "running"}>
              <text fg={palette().warning}>Query is running...</text>
            </Show>

            <Show when={job()?.status === "failed"}>
              <box flexDirection="column">
                <text fg={palette().error}>Query failed:</text>
                <text fg={palette().error}>{job()?.error || job()?.message || "Unknown error"}</text>
              </box>
            </Show>

            <Show when={hasResults()}>
              <box flexDirection="column">
                <box flexDirection="row">
                  <For each={job()?.result?.columns}>
                    {(column, index) => (
                      <>
                        <text
                          attributes={TextAttributes.BOLD}
                          fg={palette().primary}
                        >
                          {formatCell(column.name, maxColWidths()[index()])}
                        </text>
                        <Show when={index() < (job()?.result?.columns.length ?? 0) - 1}>
                          <text
                            attributes={TextAttributes.DIM}
                            fg={palette().textMuted}
                          >
                            {" | "}
                          </text>
                        </Show>
                      </>
                    )}
                  </For>
                </box>
                <box flexDirection="row">
                  <For each={job()?.result?.columns}>
                    {(_, index) => (
                      <>
                        <text
                          attributes={TextAttributes.DIM}
                          fg={palette().textMuted}
                        >
                          {"-".repeat(maxColWidths()[index()])}
                        </text>
                        <Show when={index() < (job()?.result?.columns.length ?? 0) - 1}>
                          <text
                            attributes={TextAttributes.DIM}
                            fg={palette().textMuted}
                          >
                            {" | "}
                          </text>
                        </Show>
                      </>
                    )}
                  </For>
                </box>
                <For each={job()?.result?.rows}>
                  {(row) => (
                    <box flexDirection="row">
                      <For each={row}>
                        {(cell, index) => (
                          <>
                            <text fg={palette().text}>{formatCell(cell, maxColWidths()[index()])}</text>
                            <Show when={index() < row.length - 1}>
                              <text
                                attributes={TextAttributes.DIM}
                                fg={palette().textMuted}
                              >
                                {" | "}
                              </text>
                            </Show>
                          </>
                        )}
                      </For>
                    </box>
                  )}
                </For>
              </box>
            </Show>

            <Show when={job()?.status === "success" && !hasResults()}>
              <text
                attributes={TextAttributes.DIM}
                fg={palette().textMuted}
              >
                Query completed successfully with no results
                {job()?.durationMs ? ` (${job()?.durationMs}ms)` : ""}
              </text>
            </Show>
          </box>
        </box>
      </KeyScope>
    </Show>
  );
}
