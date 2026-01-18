import { useTheme } from "@app/providers/theme"
import {
  BoxRenderable,
  type KeyEvent,
  type MouseEvent,
  type ScrollBoxRenderable,
  TextAttributes,
} from "@opentui/core"
import "./table-cell"
import { type KeyBinding, KeyScope } from "@src/core/services/key-scopes"
import type { ResultsPaneViewModel } from "@src/features/results-pane/use-results-pane"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"

export type ResultsPanelProps = {
  viewModel: ResultsPaneViewModel
}

export function ResultsPanel(props: ResultsPanelProps) {
  const pane = props.viewModel
  const job = () => pane.job()
  const { theme } = useTheme()
  const palette = theme

  let scrollRef: ScrollBoxRenderable | undefined
  const rowRenderables = new Map<number, BoxRenderable>()

  const [cursorRow, setCursorRow] = createSignal(0)
  const [cursorCol, setCursorCol] = createSignal(0)
  const [selectionCount, setSelectionCount] = createSignal(0)

  const resultRows = () => job()?.result?.rows ?? []
  const resultColumns = () => job()?.result?.columns ?? []

  const hasResults = createMemo(() => {
    const current = job()
    return current?.status === "success" && current?.result && resultRows().length > 0
  })

  const rowsAffected = () => job()?.result?.rowsAffected

  const formatCell = (value: unknown, width?: number): string => {
    return value === null || value === undefined ? "NULL" : String(value)
  }

  const columnWidths = createMemo(() => {
    if (!hasResults()) return []
    const widths = resultColumns().map((column) => column.name.length)
    for (const row of resultRows()) {
      for (let i = 0; i < row.length; i++) {
        widths[i] = Math.max(widths[i], formatCell(row[i]).length)
      }
    }
    return widths
  })

  const getViewport = () => (scrollRef as { viewport?: BoxRenderable })?.viewport

  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

  const ensureRowVisible = (rowIndex: number) => {
    const renderable = rowRenderables.get(rowIndex)
    const viewport = getViewport()
    if (!renderable || !viewport) return
    const rowTop = renderable.y ?? 0
    const rowBottom = rowTop + (renderable.height ?? 1)
    const viewportTop = viewport.y ?? 0
    const viewportBottom = viewportTop + (viewport.height ?? 0)

    if (rowBottom > viewportBottom) {
      scrollRef?.scrollBy({ x: 0, y: rowBottom - viewportBottom })
    } else if (rowTop < viewportTop) {
      scrollRef?.scrollBy({ x: 0, y: rowTop - viewportTop })
    }
  }

  const hasResultData = () => hasResults() && job()?.result
  const isActive = () => pane.isFocused()
  const hasSelection = () => selectionCount() > 0

  const handleSelectionChange = (selected: boolean) => {
    setSelectionCount((count) => Math.max(0, count + (selected ? 1 : -1)))
  }

  const SeparatorCell = (props: { selectionBg: string; bg?: string; fg?: string }) => (
    <table_cell
      width={1}
      display="│"
      fg={props.fg ?? palette().backgroundElement}
      backgroundColor={props.bg}
      attributes={TextAttributes.BOLD}
      selectionBg={props.selectionBg}
      paddingLeft={0}
      paddingRight={0}
      onSelectionChange={handleSelectionChange}
    />
  )

  const resetSelection = () => {
    setCursorRow(0)
    setCursorCol(0)
    setSelectionCount(0)
  }

  createEffect(() => {
    const current = job()
    if (!current?.result || current.status !== "success" || resultRows().length === 0) {
      resetSelection()
      return
    }
  })

  createEffect(() => {
    ensureRowVisible(cursorRow())
  })

  const moveSelection = (rowDelta: number, colDelta: number, event?: KeyEvent) => {
    if (!hasResultData()) return
    event?.preventDefault()
    if (!pane.isFocused()) {
      pane.focusSelf()
    }
    const result = job()?.result
    if (!result) return

    const nextRow = clamp(cursorRow() + rowDelta, 0, resultRows().length - 1)
    const nextCol = clamp(cursorCol() + colDelta, 0, resultColumns().length - 1)

    setCursorRow(nextRow)
    setCursorCol(nextCol)
    ensureRowVisible(nextRow)
  }

  const bindings: KeyBinding[] = [
    { pattern: "up", handler: (event) => moveSelection(-1, 0, event), preventDefault: true },
    { pattern: "k", handler: (event) => moveSelection(-1, 0, event), preventDefault: true },
    { pattern: "down", handler: (event) => moveSelection(1, 0, event), preventDefault: true },
    { pattern: "j", handler: (event) => moveSelection(1, 0, event), preventDefault: true },
    { pattern: "left", handler: (event) => moveSelection(0, -1, event), preventDefault: true },
    { pattern: "h", handler: (event) => moveSelection(0, -1, event), preventDefault: true },
    { pattern: "right", handler: (event) => moveSelection(0, 1, event), preventDefault: true },
    { pattern: "l", handler: (event) => moveSelection(0, 1, event), preventDefault: true },
  ]

  const handleCellMouseDown = (rowIndex: number, colIndex: number, event: MouseEvent) => {
    pane.focusSelf()
    event.preventDefault()
    setCursorRow(rowIndex)
    setCursorCol(colIndex)
    ensureRowVisible(rowIndex)
  }

  return (
    <Show when={pane.visible()}>
      <KeyScope
        bindings={bindings}
        enabled={pane.isFocused}
      >
        <box
          flexDirection="column"
          flexGrow={1}
          border={["top"]}
          borderColor={palette().backgroundElement}
          justifyContent="space-between"
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
            <text fg={palette().text}>Query is running... (Ctrl+G to cancel)</text>
          </Show>

          <Show when={job()?.status === "failed"}>
            <box flexDirection="column">
              <text fg={palette().error}>Query failed:</text>
              <text fg={palette().error}>{job()?.error || job()?.message || "Unknown error"}</text>
            </box>
          </Show>

          <Show when={hasResults()}>
            <box
              flexDirection="column"
              justifyContent="flex-start"
              onMouseDown={pane.focusSelf}
              paddingRight={1}
            >
              {/* Header */}
              <box
                flexDirection="row"
              >
                <SeparatorCell
                  fg={palette().backgroundPanel}
                  bg={palette().backgroundElement}
                  selectionBg={palette().backgroundElement}
                />
                <For each={resultColumns()}>
                  {(column, index) => (
                    <>
                      {index() > 0 && (
                        <SeparatorCell
                          fg={palette().backgroundPanel}
                          bg={palette().backgroundElement}
                          selectionBg={palette().backgroundElement}
                        />
                      )}

                      <table_cell
                        width={columnWidths()[index()] + 2}
                        display={formatCell(column.name, columnWidths()[index()])}
                        backgroundColor={palette().backgroundElement}
                        fg={palette().accent}
                        attributes={TextAttributes.BOLD}
                        selectionBg={palette().backgroundElement}
                        value={String(column.name)}
                        onSelectionChange={handleSelectionChange}
                      />
                    </>
                  )}
                </For>
                <SeparatorCell
                  fg={palette().backgroundPanel}
                  bg={palette().backgroundElement}
                  selectionBg={palette().backgroundElement}
                />
              </box>
              { /* Rows */}
              <scrollbox
                ref={(node: ScrollBoxRenderable | undefined) => {
                  scrollRef = node ?? undefined
                }}
                maxHeight={18}
                onMouseDown={pane.focusSelf}
              >
                <box flexDirection="column">
                  <For each={resultRows()}>
                    {(row, rowIndex) => (
                      <box
                        flexDirection="row"
                        ref={(ref: BoxRenderable | undefined) => {
                          if (!ref) {
                            rowRenderables.delete(rowIndex())
                            return
                          }
                          rowRenderables.set(rowIndex(), ref)
                        }}
                      >
                        <For each={row}>
                          {(cell, colIndex) => {
                            const isCursorOn = () => {
                              return isActive() && cursorRow() === rowIndex() && cursorCol() === colIndex()
                            }
                            const rowBg = () => {
                              if (isCursorOn()) {
                                return palette().primary
                              }

                              return undefined
                            }
                            return (
                              <>
                                <SeparatorCell selectionBg={palette().backgroundElement} />
                                <table_cell
                                  backgroundColor={rowBg()}
                                  flexDirection="row"
                                  width={columnWidths()[colIndex()] + 2}
                                  align={typeof cell === "number" ? "right" : "left"}
                                  onMouseDown={(event: MouseEvent) =>
                                    handleCellMouseDown(rowIndex(), colIndex(), event)
                                  }
                                  selectionBg={palette().backgroundElement}
                                  value={String(cell)}
                                  display={formatCell(cell, columnWidths()[colIndex()])}
                                  fg={isCursorOn() && !hasSelection() ? palette().background : palette().text}
                                  onSelectionChange={handleSelectionChange}
                                />
                                {colIndex() === row.length - 1 && <SeparatorCell
                                  bg={rowBg()}
                                  selectionBg={palette().backgroundElement}
                                />}
                              </>
                            )
                          }}
                        </For>

                      </box>
                    )}
                  </For>
                </box>
              </scrollbox>
            </box>
          </Show>

          <box
            height={1}
            flexDirection="row"
            justifyContent="flex-end"
            width="100%"
            gap={1}
            paddingRight={3}
          >
            <Show when={hasResults() && pane.isFocused()}>
              <text fg={palette().textMuted}>{`row ${cursorRow() + 1} / ${resultRows().length}`}</text>
            </Show>
          </box>

          <Show when={job()?.status === "success" && !hasResults()}>
            <text
              attributes={TextAttributes.DIM}
            >
              Query completed successfully in
              {job()?.durationMs ? ` ${job()?.durationMs}ms` : ""}
              {rowsAffected() !== undefined ? `; ${rowsAffected()} rows affected` : ""}
            </text>
          </Show>

        </box>
      </KeyScope>
    </Show>
  )
}
