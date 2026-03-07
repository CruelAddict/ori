import {
  type BoxRenderable,
  type KeyEvent,
  type MouseEvent,
  type ScrollBoxRenderable,
  TextAttributes,
} from "@opentui/core"
import { getViewportRect, OriScrollbox, scrollIntoView } from "@ui/components/ori-scrollbox"
import { useTheme } from "@ui/providers/theme"
import "./table-cell"
import { type KeyBinding, KeyScope } from "@ui/services/key-scopes"
import { setSelectionOverride } from "@utils/clipboard"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import type { ResultsPaneViewModel } from "./view-model/create-vm"

export type ResultsPanelProps = {
  viewModel: ResultsPaneViewModel
}

const resultsScrollSpeed = {
  horizontal: 4,
  vertical: 2,
}

const HORIZONTAL_SCROLL_STEP = 6

export function ResultsPanel(props: ResultsPanelProps) {
  const pane = props.viewModel
  const { theme } = useTheme()

  let scrollRef: ScrollBoxRenderable | undefined
  let rowScrollRef: ScrollBoxRenderable | undefined
  let rowNumberBottomPadding: 0 | 1 = 0
  let bodyViewportSize: { width: number; height: number } | null = null
  const rowRenderables = new Map<number, BoxRenderable>()
  const [rowVersion, setRowVersion] = createSignal(0)

  const [scrollLeft, setScrollLeft] = createSignal(0)

  const [cursorRow, setCursorRow] = createSignal(0)
  const [cursorCol, setCursorCol] = createSignal(0)
  const [selectionCount, setSelectionCount] = createSignal(0)

  const selectedHeaderCols = new Set<number>()
  const selectedRowCols = new Map<number, Set<number>>()

  const resultRows = () => pane.job()?.result?.rows ?? []
  const resultColumns = () => pane.job()?.result?.columns ?? []

  const hasResults = createMemo(() => {
    const current = pane.job()
    return current?.status === "success" && current?.result && resultRows().length > 0
  })

  const rowsAffected = () => pane.job()?.result?.rowsAffected

  const formatCell = (value: unknown): string => {
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

  const rowNumberWidth = createMemo(() => String(resultRows().length).length)
  const rowNumberCellWidth = createMemo(() => rowNumberWidth() + 2)
  const rowNumberLaneWidth = createMemo(() => rowNumberCellWidth())

  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

  const ensureRowVisible = (rowIndex: number) => {
    rowVersion()
    const renderable = rowRenderables.get(rowIndex)
    if (!renderable) {
      return
    }
    if (renderable.x === undefined || renderable.y === undefined) {
      return
    }
    if (!Number.isFinite(renderable.x) || !Number.isFinite(renderable.y)) {
      return
    }
    scrollIntoView(
      scrollRef,
      {
        x: renderable.x,
        y: renderable.y,
      },
      {
        trackX: false,
      },
    )
  }

  const ensureColumnVisible = (colIndex: number) => {
    if (!scrollRef) return
    const viewport = getViewportRect(scrollRef)
    if (!viewport) return

    const widths = columnWidths()
    // Calculate the x position of the column (sum of previous column widths + separators)
    let colLeft = 1 // Initial separator
    for (let i = 0; i < colIndex; i++) {
      colLeft += widths[i] + 2 + 1 // width + padding + separator
    }
    const colWidth = widths[colIndex] + 2
    const colRight = colLeft + colWidth

    const viewportWidth = viewport.width
    const currentScrollLeft = scrollRef.scrollLeft ?? 0
    const viewportLeft = currentScrollLeft
    const viewportRight = currentScrollLeft + viewportWidth

    if (colRight > viewportRight) {
      const delta = colRight - viewportRight
      scrollRef.scrollBy({ x: delta, y: 0 })
      syncScrollState()
    } else if (colLeft < viewportLeft) {
      const delta = colLeft - viewportLeft
      scrollRef.scrollBy({ x: delta, y: 0 })
      syncScrollState()
    }
  }

  const handleManualHorizontalScroll = (direction: "left" | "right") => {
    if (!hasResults()) return
    const delta = direction === "left" ? -HORIZONTAL_SCROLL_STEP : HORIZONTAL_SCROLL_STEP
    scrollRef?.scrollBy({ x: delta, y: 0 })
    syncScrollState()
  }

  const hasResultData = () => hasResults() && pane.job()?.result
  const isActive = () => pane.isFocused()
  const hasSelection = () => selectionCount() > 0
  const cursorCellBackground = createMemo(() => theme().get("primary"))

  const handleHeaderSelectionChange = (colIndex: number, selected: boolean) => {
    if (selected) {
      selectedHeaderCols.add(colIndex)
    } else {
      selectedHeaderCols.delete(colIndex)
    }
    setSelectionCount((count) => Math.max(0, count + (selected ? 1 : -1)))
  }

  const handleRowSelectionChange = (rowIndex: number, colIndex: number, selected: boolean) => {
    if (selected) {
      let rowSelection = selectedRowCols.get(rowIndex)
      if (!rowSelection) {
        rowSelection = new Set()
        selectedRowCols.set(rowIndex, rowSelection)
      }
      rowSelection.add(colIndex)
    } else {
      const rowSelection = selectedRowCols.get(rowIndex)
      rowSelection?.delete(colIndex)
      if (rowSelection && rowSelection.size === 0) {
        selectedRowCols.delete(rowIndex)
      }
    }
    setSelectionCount((count) => Math.max(0, count + (selected ? 1 : -1)))
  }

  const buildSelectedTsv = (): string | undefined => {
    if (selectedHeaderCols.size === 0 && selectedRowCols.size === 0) {
      return
    }
    const columnIndexes = resultColumns()
      .map((_, index) => index)
      .filter((index) => {
        if (selectedHeaderCols.has(index)) return true
        for (const cols of selectedRowCols.values()) {
          if (cols.has(index)) return true
        }
        return false
      })
    if (columnIndexes.length === 0) {
      return
    }
    const lines: string[] = []
    if (selectedHeaderCols.size > 0) {
      const header = columnIndexes.map((index) => String(resultColumns()[index]?.name ?? "")).join("\t")
      lines.push(header)
    }
    const rowIndexes = Array.from(selectedRowCols.keys()).sort((a, b) => a - b)
    for (const rowIndex of rowIndexes) {
      const row = resultRows()[rowIndex] ?? []
      const line = columnIndexes.map((colIndex) => String(row[colIndex])).join("\t")
      lines.push(line)
    }
    if (lines.length === 0) {
      return
    }
    return lines.join("\n")
  }

  const SeparatorCell = (props: { selectionBg: string; bg?: string; fg?: string }) => (
    <table_cell
      width={1}
      display="│"
      fg={props.fg ?? theme().get("border")}
      defaultFg={theme().get("border")}
      backgroundColor={props.bg}
      attributes={TextAttributes.BOLD}
      selectionBg={props.selectionBg}
      paddingLeft={0}
      paddingRight={0}
    />
  )

  const syncScrollState = () => {
    const left = scrollRef?.scrollLeft ?? 0
    const top = scrollRef?.scrollTop ?? 0
    const nextRowNumberBottomPadding: 0 | 1 = scrollRef?.horizontalScrollBar.visible ? 1 : 0

    if (scrollLeft() !== left) {
      setScrollLeft(left)
    }
    if (rowScrollRef && rowNumberBottomPadding !== nextRowNumberBottomPadding) {
      rowNumberBottomPadding = nextRowNumberBottomPadding
      rowScrollRef.paddingBottom = nextRowNumberBottomPadding
    }
    if (rowScrollRef && rowScrollRef.scrollTop !== top) {
      rowScrollRef.scrollTo({ x: 0, y: top })
    }
  }

  const handleBodySync = () => {
    syncScrollState()
    const viewport = getViewportRect(scrollRef)
    if (!viewport) {
      bodyViewportSize = null
      return
    }
    if (bodyViewportSize && bodyViewportSize.width === viewport.width && bodyViewportSize.height === viewport.height) {
      return
    }
    bodyViewportSize = {
      width: viewport.width,
      height: viewport.height,
    }
    ensureRowVisible(cursorRow())
  }

  const resetScroll = () => {
    setScrollLeft(0)
    if (scrollRef) {
      scrollRef.scrollTo({ x: 0, y: 0 })
    }
    if (rowScrollRef) {
      rowScrollRef.scrollTo({ x: 0, y: 0 })
    }
  }

  const resetPaneState = () => {
    setCursorRow(0)
    setCursorCol(0)
    setSelectionCount(0)
    resetScroll()
    selectedHeaderCols.clear()
    selectedRowCols.clear()
  }

  createEffect(() => {
    pane.job()
    resultRows().length === 0
    resetPaneState()
  })

  createEffect(() => {
    if (!hasResultData()) return
    rowVersion()
    ensureRowVisible(cursorRow())
  })

  setSelectionOverride(() => buildSelectedTsv())
  onCleanup(() => {
    setSelectionOverride()
  })

  const moveSelection = (rowDelta: number, colDelta: number, event?: KeyEvent) => {
    if (!hasResultData()) return
    event?.preventDefault()
    if (!pane.isFocused()) {
      pane.focusSelf()
    }
    const result = pane.job()?.result
    if (!result) return

    const nextRow = clamp(cursorRow() + rowDelta, 0, resultRows().length - 1)
    const nextCol = clamp(cursorCol() + colDelta, 0, resultColumns().length - 1)

    setCursorRow(nextRow)
    setCursorCol(nextCol)
    if (colDelta !== 0) {
      ensureColumnVisible(nextCol)
    }
  }

  const bindings: KeyBinding[] = [
    { pattern: "up", handler: (event) => moveSelection(-1, 0, event), preventDefault: true },
    { pattern: "k", handler: (event) => moveSelection(-1, 0, event), preventDefault: true },
    { pattern: "down", handler: (event) => moveSelection(1, 0, event), preventDefault: true },
    { pattern: "j", handler: (event) => moveSelection(1, 0, event), preventDefault: true },
    { pattern: "left", handler: (event) => moveSelection(0, -1, event), preventDefault: true },
    { pattern: "h", handler: (event) => moveSelection(0, -1, event), preventDefault: true },
    { pattern: ["ctrl+h", "backspace"], handler: () => handleManualHorizontalScroll("left"), preventDefault: true },
    { pattern: "right", handler: (event) => moveSelection(0, 1, event), preventDefault: true },
    { pattern: "l", handler: (event) => moveSelection(0, 1, event), preventDefault: true },
    { pattern: "ctrl+l", handler: () => handleManualHorizontalScroll("right"), preventDefault: true },
  ]

  const handleCellMouseDown = (rowIndex: number, colIndex: number, event: MouseEvent) => {
    pane.focusSelf()
    event.preventDefault()
    setCursorRow(rowIndex)
    setCursorCol(colIndex)
  }

  return (
    <KeyScope
      bindings={bindings}
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
          <text fg={theme().get("text")}>Query is running... (Ctrl+G to cancel)</text>
        </Show>

        <Show when={pane.job()?.status === "failed"}>
          <box flexDirection="column">
            <text fg={theme().get("error")}>Query failed:</text>
            <text fg={theme().get("error")}>{pane.job()?.error || pane.job()?.message || "Unknown error"}</text>
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
              overflow="hidden"
              backgroundColor={theme().get("results_header_background")}
              minHeight={1}
            >
              <box
                flexDirection="row"
                backgroundColor={theme().get("panel_background")}
                zIndex={1}
                width={rowNumberLaneWidth()}
                minWidth={rowNumberLaneWidth()}
                maxWidth={rowNumberLaneWidth()}
                flexShrink={0}
              >
                <table_cell
                  width={rowNumberCellWidth()}
                  display={""}
                  backgroundColor={theme().get("panel_background")}
                  fg={theme().get("panel_background")}
                  defaultFg={theme().get("panel_background")}
                  attributes={TextAttributes.DIM}
                  selectionBg={theme().get("results_selection_background")}
                />
              </box>
              <box
                flexGrow={1}
                flexShrink={1}
                minWidth={0}
                overflow="hidden"
                backgroundColor={theme().get("results_header_background")}
              >
                <box
                  flexDirection="row"
                  marginLeft={-scrollLeft()}
                  backgroundColor={theme().get("results_header_background")}
                >
                  <SeparatorCell
                    fg={theme().get("border")}
                    bg={theme().get("results_header_background")}
                    selectionBg={theme().get("results_selection_background")}
                  />
                  <For each={resultColumns()}>
                    {(column, index) => (
                      <>
                        {index() > 0 && (
                          <SeparatorCell
                            fg={theme().get("border")}
                            bg={theme().get("results_header_background")}
                            selectionBg={theme().get("results_selection_background")}
                          />
                        )}

                        <table_cell
                          width={columnWidths()[index()] + 2}
                          display={formatCell(column.name)}
                          backgroundColor={theme().get("results_header_background")}
                          fg={theme().get("results_column_title")}
                          defaultFg={theme().get("results_column_title")}
                          attributes={TextAttributes.BOLD}
                          selectionBg={theme().get("results_selection_background")}
                          value={String(column.name)}
                          onSelectionChange={(selected: boolean) => handleHeaderSelectionChange(index(), selected)}
                        />
                      </>
                    )}
                  </For>
                  <SeparatorCell
                    fg={theme().get("border")}
                    bg={theme().get("results_header_background")}
                    selectionBg={theme().get("results_selection_background")}
                  />
                </box>
              </box>
            </box>
            {/* Rows */}
            <box flexDirection="row">
              <OriScrollbox
                onReady={(node: ScrollBoxRenderable | undefined) => {
                  rowScrollRef = node ?? undefined
                  if (!rowScrollRef) return
                  rowNumberBottomPadding = 0
                  rowScrollRef.paddingBottom = 0
                  rowScrollRef.scrollTo({ x: 0, y: scrollRef?.scrollTop ?? 0 })
                }}
                flexDirection="column"
                width={rowNumberLaneWidth()}
                scrollX={false}
                scrollY={false}
                scrollbarOptions={{ visible: false }}
                backgroundColor={theme().get("panel_background")}
                contentOptions={{
                  maxWidth: rowNumberCellWidth(),
                  width: rowNumberCellWidth(),
                }}
              >
                <box flexDirection="column">
                  <For each={resultRows()}>
                    {(_, rowIndex) => {
                      const rowNumberColor = () =>
                        isActive() && cursorRow() === rowIndex()
                          ? theme().get("results_row_number_cursor")
                          : theme().get("results_row_number")

                      return (
                        <box
                          flexDirection="row"
                          backgroundColor={theme().get("panel_background")}
                        >
                          <table_cell
                            width={rowNumberCellWidth()}
                            display={String(rowIndex() + 1)}
                            align="right"
                            backgroundColor={theme().get("panel_background")}
                            fg={rowNumberColor()}
                            defaultFg={rowNumberColor()}
                            selectionBg={theme().get("results_selection_background")}
                          />
                        </box>
                      )
                    }}
                  </For>
                </box>
              </OriScrollbox>
              <OriScrollbox
                onReady={(node: ScrollBoxRenderable | undefined) => {
                  scrollRef = node ?? undefined
                  if (!scrollRef) return
                  scrollRef.scrollTo({ x: 0, y: 0 })
                  setScrollLeft(0)
                  const viewport = getViewportRect(scrollRef)
                  bodyViewportSize = viewport
                    ? {
                        width: viewport.width,
                        height: viewport.height,
                      }
                    : null
                  syncScrollState()
                  ensureRowVisible(cursorRow())
                }}
                onSync={handleBodySync}
                scrollSpeed={resultsScrollSpeed}
                minHorizontalThumbWidth={5}
                flexGrow={1}
                onMouseDown={pane.focusSelf}
                contentOptions={{
                  maxWidth: undefined,
                  width: "auto",
                }}
              >
                <box
                  flexDirection="column"
                  width={"auto"}
                >
                  <For each={resultRows()}>
                    {(row, rowIndex) => {
                      const rowBackground = () =>
                        rowIndex() % 2 === 0
                          ? theme().get("panel_background")
                          : theme().get("results_row_alt_background")
                      return (
                        <box
                          flexDirection="row"
                          backgroundColor={rowBackground()}
                          ref={(ref: BoxRenderable | undefined) => {
                            if (!ref) {
                              rowRenderables.delete(rowIndex())
                              setRowVersion((value) => value + 1)
                              return
                            }
                            rowRenderables.set(rowIndex(), ref)
                            setRowVersion((value) => value + 1)
                          }}
                        >
                          <SeparatorCell
                            bg={
                              isActive() && cursorRow() === rowIndex() && cursorCol() === 0 && !hasSelection()
                                ? cursorCellBackground()
                                : rowBackground()
                            }
                            fg={
                              isActive() && cursorRow() === rowIndex() && cursorCol() === 0 && !hasSelection()
                                ? cursorCellBackground()
                                : theme().get("border")
                            }
                            selectionBg={theme().get("results_selection_background")}
                          />
                          <For each={row}>
                            {(cell, colIndex) => {
                              const isCursor = () =>
                                isActive() &&
                                cursorRow() === rowIndex() &&
                                cursorCol() === colIndex() &&
                                !hasSelection()
                              const isCursorOnLeftCell = () =>
                                colIndex() > 0 &&
                                isActive() &&
                                !hasSelection() &&
                                cursorRow() === rowIndex() &&
                                cursorCol() === colIndex() - 1
                              const cursorBackground = () => cursorCellBackground()
                              return (
                                <>
                                  {colIndex() > 0 && (
                                    <SeparatorCell
                                      bg={isCursor() || isCursorOnLeftCell() ? cursorBackground() : undefined}
                                      fg={
                                        isCursor() || isCursorOnLeftCell() ? cursorBackground() : theme().get("border")
                                      }
                                      selectionBg={theme().get("results_selection_background")}
                                    />
                                  )}
                                  <table_cell
                                    backgroundColor={isCursor() ? cursorBackground() : undefined}
                                    flexDirection="row"
                                    width={columnWidths()[colIndex()] + 2}
                                    align={typeof cell === "number" ? "right" : "left"}
                                    onMouseDown={(event: MouseEvent) =>
                                      handleCellMouseDown(rowIndex(), colIndex(), event)
                                    }
                                    selectionBg={theme().get("results_selection_background")}
                                    value={String(cell)}
                                    display={formatCell(cell)}
                                    fg={
                                      isCursor() && !hasSelection()
                                        ? theme().get("selection_foreground")
                                        : theme().get("text")
                                    }
                                    defaultFg={theme().get("text")}
                                    onSelectionChange={(selected: boolean) =>
                                      handleRowSelectionChange(rowIndex(), colIndex(), selected)
                                    }
                                  />
                                  {colIndex() === row.length - 1 && (
                                    <SeparatorCell
                                      bg={isCursor() ? cursorBackground() : undefined}
                                      fg={isCursor() ? cursorBackground() : theme().get("border")}
                                      selectionBg={theme().get("results_selection_background")}
                                    />
                                  )}
                                </>
                              )
                            }}
                          </For>
                        </box>
                      )
                    }}
                  </For>
                </box>
              </OriScrollbox>
            </box>
          </box>
        </Show>

        <Show when={pane.job()?.status === "success" && !hasResults()}>
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
