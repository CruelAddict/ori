import { TextAttributes } from "@opentui/core"
import { OriTable } from "@ui/components/ori-table/ori-table"
import { useTheme } from "@ui/providers/theme"
import { createMemo, Show } from "solid-js"
import type { ResultsPaneViewModel } from "./view-model/create-vm"

export type ResultsPanelProps = {
  viewModel: ResultsPaneViewModel
}

export function ResultsPanel(props: ResultsPanelProps) {
  const pane = props.viewModel
  const { theme } = useTheme()

  const resultRows = () => pane.job()?.result?.rows ?? []
  const resultColumns = () => pane.job()?.result?.columns ?? []
  const rowsAffected = () => pane.job()?.result?.rowsAffected
  const hasRows = createMemo(() => {
    const current = pane.job()
    return current?.status === "success" && current?.result && resultRows().length > 0
  })

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      justifyContent="space-between"
      backgroundColor={theme().get("panel_background")}
      gap={0}
    >
      <Show when={!pane.job()}>
        <text
          attributes={TextAttributes.DIM}
          fg={theme().get("text_muted")}
        >
          No query executed yet
        </text>
      </Show>

      <Show when={pane.job()?.status === "running"}>
        <text fg={theme().get("text")}>Query is running... (Ctrl+G to cancel)</text>
      </Show>

      <Show when={pane.job()?.status === "failed"}>
        <box flexDirection="column">
          <text fg={theme().get("error")}>Query failed:</text>
          <text fg={theme().get("error")}>{pane.job()?.error || pane.job()?.message || "Unknown error"}</text>
        </box>
      </Show>

      <Show when={hasRows()}>
        <OriTable
          columns={resultColumns()}
          rows={resultRows()}
          colors={{
            background: theme().get("panel_background"),
            alternateRowBackground: theme().get("results_row_alt_background"),
            headerBackground: theme().get("results_header_background"),
            headerText: theme().get("results_column_title"),
            rowNumber: theme().get("results_row_number"),
            cursorRowNumber: theme().get("results_row_number_cursor"),
            border: theme().get("border"),
            cursorBackground: theme().get("primary"),
            cursorForeground: theme().get("selection_foreground"),
            text: theme().get("text"),
            selectionBackground: theme().get("results_selection_background"),
          }}
          isFocused={pane.isFocused}
          focusSelf={pane.focusSelf}
        />
      </Show>

      <Show when={pane.job()?.status === "success" && !hasRows()}>
        <text attributes={TextAttributes.DIM}>
          Query completed successfully in
          {pane.job()?.durationMs ? ` ${pane.job()?.durationMs}ms` : ""}
          {rowsAffected() !== undefined ? `; ${rowsAffected()} rows affected` : ""}
        </text>
      </Show>
    </box>
  )
}
