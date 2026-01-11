import { useTheme } from "@app/providers/theme"
import {
  type BoxRenderable,
  type KeyEvent,
  type MouseEvent,
  type ScrollBoxRenderable,
  TextAttributes,
} from "@opentui/core"
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

  const [selectedRow, setSelectedRow] = createSignal(0)
  const [selectedCol, setSelectedCol] = createSignal(0)

  const hasResults = createMemo(() => {
    const current = job()
    return current?.status === "success" && current?.result && current.result.rows.length > 0
  })

  const formatCell = (value: unknown, width?: number): string => {
    return value === null || value === undefined ? "NULL" : String(value)
  }

  const columnWidths = createMemo(() => {
    const current = job()
    if (!hasResults()) return []
    const result = current!.result
    const widths = result!.columns.map((column) => column.name.length)
    for (const row of result!.rows) {
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

  const resetSelection = () => {
    setSelectedRow(0)
    setSelectedCol(0)
  }

  createEffect(() => {
    const current = job()
    if (!current?.result || current.status !== "success" || current.result.rows.length === 0) {
      resetSelection()
      return
    }
  })

  createEffect(() => {
    ensureRowVisible(selectedRow())
  })

  const moveSelection = (rowDelta: number, colDelta: number, event?: KeyEvent) => {
    if (!hasResultData()) return
    event?.preventDefault()
    if (!pane.isFocused()) {
      pane.focusSelf()
    }
    const result = job()?.result
    if (!result) return

    const nextRow = clamp(selectedRow() + rowDelta, 0, result.rows.length - 1)
    const nextCol = clamp(selectedCol() + colDelta, 0, result.columns.length - 1)

    setSelectedRow(nextRow)
    setSelectedCol(nextCol)
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
    setSelectedRow(rowIndex)
    setSelectedCol(colIndex)
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
            <text fg={palette().warning}>Query is running...</text>
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
              <box
                flexDirection="row"
                gap={1}
                paddingLeft={1}
              >
                <For each={job()?.result?.columns}>
                  {(column, index) => (
                    <>
                      <Show when={index() > 0}>
                        <text
                          fg={palette().textMuted}
                          attributes={TextAttributes.DIM}
                          wrapMode="none"
                        >
                          │
                        </text>
                      </Show>
                      <text
                        fg={palette().accent}
                        attributes={TextAttributes.BOLD}
                        wrapMode="none"
                        width={columnWidths()[index()]}
                      >
                        {formatCell(column.name, columnWidths()[index()])}
                      </text>
                    </>
                  )}
                </For>
              </box>
              <scrollbox
                ref={(node: ScrollBoxRenderable | undefined) => {
                  scrollRef = node ?? undefined
                }}
                maxHeight={18}
                onMouseDown={pane.focusSelf}
              >
                <box flexDirection="column">
                  <For each={job()?.result?.rows}>
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
                            const isSelected = () => {
                              return isActive() && selectedRow() == rowIndex() && selectedCol() == colIndex()
                            }
                            return (
                              <>
                                <Show when={colIndex() > 0}>
                                  <text
                                    fg={palette().textMuted}
                                    attributes={TextAttributes.DIM}
                                    wrapMode="none"
                                  >
                                    │
                                  </text>
                                </Show>
                                <box
                                  backgroundColor={isSelected() ? palette().primary : undefined}
                                  paddingLeft={1}
                                  paddingRight={1}
                                  flexDirection="row"
                                  width={columnWidths()[colIndex()] + 2}
                                  justifyContent={typeof cell === "number" ? "flex-end" : "flex-start"}
                                  onMouseDown={(event: MouseEvent) =>
                                    handleCellMouseDown(rowIndex(), colIndex(), event)
                                  }
                                >
                                  <text
                                    wrapMode="none"
                                    fg={isSelected() ? palette().background : palette().text}
                                  >
                                    {formatCell(cell, columnWidths()[colIndex()])}
                                  </text>
                                </box>
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
              <text fg={palette().textMuted}>{`row ${selectedRow() + 1} / ${job()?.result?.rows.length}`}</text>
            </Show>
          </box>

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
      </KeyScope>
    </Show>
  )
}
