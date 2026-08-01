import { TextAttributes } from "@opentui/core"
import { OriTable } from "@ui/components/ori-table/ori-table"
import { useTheme } from "@ui/providers/theme"
import { type KeyBinding, KeyScope } from "@ui/services/key-scopes"
import { createMemo, Show } from "solid-js"
import type { ResultsPaneViewModel } from "./view-model/create-vm"

export type ResultsPanelProps = {
  viewModel: ResultsPaneViewModel
}

export function ResultsPanel(props: ResultsPanelProps) {
  const pane = props.viewModel
  const { theme } = useTheme()

  const keyBindings: KeyBinding[] = [
    {
      pattern: ["{", "shift+["],
      description: "First result page",
      handler: () => {
        void pane.loadFirstPage()
      },
      enabled: pane.canLoadFirstPage,
      preventDefault: true,
      commandPaletteSection: "Query",
    },
    {
      pattern: "[",
      description: "Previous result page",
      handler: () => {
        void pane.loadPreviousPage()
      },
      enabled: pane.canLoadPreviousPage,
      preventDefault: true,
      commandPaletteSection: "Query",
    },
    {
      pattern: "]",
      description: "Next result page",
      handler: () => {
        void pane.loadNextPage()
      },
      enabled: pane.canLoadNextPage,
      preventDefault: true,
      commandPaletteSection: "Query",
    },
    {
      pattern: ["}", "shift+]"],
      description: "Last result page",
      handler: () => {
        void pane.loadLastPage()
      },
      enabled: pane.canLoadLastPage,
      preventDefault: true,
      commandPaletteSection: "Query",
    },
  ]

  const resultRows = () => pane.job()?.result?.rows ?? []
  const resultColumns = () => pane.job()?.result?.columns ?? []
  const rowsAffected = () => pane.job()?.result?.rowsAffected
  const hasRows = createMemo(() => {
    const current = pane.job()
    return current?.status === "success" && current?.result && resultRows().length > 0
  })

  return (
    <KeyScope
      bindings={keyBindings}
      enabled={pane.isFocused}
    >
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
          <text fg={theme().get("text")}>
            {pane.job()?.statusUnavailable
              ? "Query is running; status unavailable, retrying... (Ctrl+G to cancel)"
              : "Query is running... (Ctrl+G to cancel)"}
          </text>
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
            rowNumberOffset={pane.pagination()?.offset ?? 0}
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
            isVisible={pane.isVisible}
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
    </KeyScope>
  )
}
