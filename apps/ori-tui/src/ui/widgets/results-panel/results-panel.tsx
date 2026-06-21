import { type KeyEvent, type MouseEvent, type Selection as OpenTuiSelection, TextAttributes } from "@opentui/core"
import { OriScrollbox, type OriScrollboxUserScrollContext } from "@ui/components/ori-scrollbox"
import { useLogger } from "@ui/providers/logger"
import { useTheme } from "@ui/providers/theme"
import { type KeyBinding, KeyScope } from "@ui/services/key-scopes"
import { setSelectionOverride } from "@utils/clipboard"
import { createEffect, createMemo, createSignal, For, Index, onCleanup, Show, untrack } from "solid-js"
import {
  type CellRef,
  type CellSelection,
  createResultsGrid,
  dataRow,
  formatResultCell,
  gridCol,
  type ResultsGrid,
} from "./results-grid"
import { createResultsViewport } from "./results-viewport"
import "./table-cell"
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
  const logger = useLogger()

  const [cursorRow, setCursorRow] = createSignal(0)
  const [cursorCol, setCursorCol] = createSignal(0)
  const [selectionStart, setSelectionStart] = createSignal<CellRef | null>(null)
  const [selectionEnd, setSelectionEnd] = createSignal<CellRef | null>(null)

  const resultRows = () => pane.job()?.result?.rows ?? []
  const resultColumns = () => pane.job()?.result?.columns ?? []
  const rowsAffected = () => pane.job()?.result?.rowsAffected
  const hasResults = createMemo(() => {
    const current = pane.job()
    return current?.status === "success" && current?.result && resultRows().length > 0
  })
  const grid = createMemo<ResultsGrid | null>(() => {
    if (!hasResults()) return null
    return createResultsGrid({ columns: resultColumns(), rows: resultRows() })
  })
  const viewport = createResultsViewport({ grid })
  const jobResetKey = createMemo(() => {
    const job = pane.job()
    if (!job) return ""
    return `${job.jobId}:${job.status}`
  })

  const rowNumberWidth = createMemo(() => String(resultRows().length).length)
  const rowNumberCellWidth = createMemo(() => rowNumberWidth() + 2)
  const selectedCells = createMemo<CellSelection | null>(() => {
    const start = selectionStart()
    const end = selectionEnd()
    return start && end ? { start, end } : null
  })
  const visibleRowIds = createMemo(() => viewport.visibleRows().map((item) => item.row))
  const cursorCellBackground = createMemo(() => theme().get("primary"))
  const hasSelection = () => Boolean(selectedCells())
  const showCursor = () => pane.isFocused() && !hasSelection()
  const cursorCell = (): CellRef => ({ kind: "body", row: dataRow(cursorRow()), col: gridCol(cursorCol()) })

  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

  const sameCell = (left: CellRef | null, right: CellRef | null) => {
    if (!left || !right) return left === right
    if (left.kind !== right.kind || left.col !== right.col) return false
    if (left.kind === "header") return true
    return right.kind === "body" && left.row === right.row
  }

  const setSelectionEndIfChanged = (cell: CellRef | null) => {
    setSelectionEnd((current) => (sameCell(current, cell) ? current : cell))
  }

  const clearSelection = () => {
    setSelectionStart(null)
    setSelectionEnd(null)
  }

  const describeCell = (cell: CellRef | null) => {
    if (!cell) return null
    if (cell.kind === "header") return { kind: cell.kind, col: Number(cell.col) }
    return { kind: cell.kind, row: Number(cell.row), rowNumber: Number(cell.row) + 1, col: Number(cell.col) }
  }

  const describeNativeSelection = (selection: OpenTuiSelection | null) => {
    if (!selection) return null
    return {
      isActive: selection.isActive,
      isDragging: selection.isDragging,
      isStart: selection.isStart,
      anchor: selection.anchor,
      focus: selection.focus,
      bounds: selection.bounds,
      selectedRenderables: selection.selectedRenderables.length,
      touchedRenderables: selection.touchedRenderables.length,
    }
  }

  const displayedRows = (current: ResultsGrid | null) =>
    viewport.visibleRows().map((item) => ({
      row: Number(item.row),
      rowNumber: Number(item.row) + 1,
      top: Number(item.top),
      renderedTop: Number(item.top - viewport.scrollTop()),
      height: Number(item.height),
      values: (current?.rows[item.row] ?? []).slice(0, 8).map(formatResultCell),
      hiddenCellCount: Math.max(0, (current?.rows[item.row]?.length ?? 0) - 8),
    }))

  const logDisplayedState = (cause: string, extra: Record<string, unknown> = {}) => {
    if (!logger.isLevelEnabled("debug")) return

    untrack(() => {
      const current = grid()
      const selection = selectedCells()
      logger.debug(
        {
          cause,
          jobId: pane.job()?.jobId,
          focused: pane.isFocused(),
          cursor: { row: cursorRow(), rowNumber: cursorRow() + 1, col: cursorCol() },
          selection: {
            start: describeCell(selectionStart()),
            end: describeCell(selectionEnd()),
            bounds: selection && current ? current.cellSelectionBounds(selection) : null,
            native: describeNativeSelection(viewport.nativeSelection()),
          },
          rowNumberWidth: rowNumberWidth(),
          rowNumberCellWidth: rowNumberCellWidth(),
          viewport: viewport.debugSnapshot(),
          displayedRows: displayedRows(current),
          ...extra,
        },
        "results panel: displayed state",
      )
    })
  }

  const warnBrokenInvariants = (cause: string) => {
    if (!logger.isLevelEnabled("warn")) return

    untrack(() => {
      const snapshot = viewport.debugSnapshot()
      const scrollbox = snapshot.scrollbox
      const problems: string[] = []

      if (!Number.isInteger(Number(snapshot.scrollTop))) {
        problems.push("viewport scrollTop is not an integer visual row")
      }
      if (scrollbox && Number(snapshot.scrollTop) > scrollbox.maxScrollTop) {
        problems.push("viewport scrollTop is beyond scrollbox maxScrollTop")
      }
      for (const row of snapshot.visibleRows) {
        if (!Number.isInteger(Number(row.renderedTop))) {
          problems.push("visible row renderedTop is not an integer terminal row")
          break
        }
      }

      if (problems.length === 0) return

      logger.warn({ cause, problems, snapshot }, "results panel: broken viewport invariants")
    })
  }

  const processMouseDragSelection = (selection: OpenTuiSelection | null) => {
    const before = selectionEnd()
    if (!selection?.isActive) return
    if (selection.isStart) {
      setSelectionEndIfChanged(null)
      logDisplayedState("selection-start", {
        nativeSelection: describeNativeSelection(selection),
        previousSelectionEnd: describeCell(before),
        nextSelectionEnd: null,
      })
      return
    }
    const next = viewport.cellAtScreenPoint(selection.focus)
    setSelectionEndIfChanged(next)
    logDisplayedState("selection-drag", {
      nativeSelection: describeNativeSelection(selection),
      previousSelectionEnd: describeCell(before),
      nextSelectionEnd: describeCell(next),
    })
    warnBrokenInvariants("selection-drag")
  }

  setSelectionOverride(() => grid()?.cellSelectionText(selectedCells()))
  onCleanup(() => {
    setSelectionOverride()
  })

  createEffect(() => {
    jobResetKey()
    setCursorRow(0)
    setCursorCol(0)
    clearSelection()
    viewport.reset()
    logDisplayedState("job-reset")
  })

  createEffect(() => {
    if (!grid()) return
    viewport.scrollCellIntoView(cursorCell())
  })

  createEffect(() => {
    if (!grid()) return
    logDisplayedState("displayed-rows-change")
    warnBrokenInvariants("displayed-rows-change")
  })

  const moveSelection = (rowDelta: number, colDelta: number, event?: KeyEvent) => {
    const current = grid()
    if (!current) return

    event?.preventDefault()
    if (!pane.isFocused()) {
      pane.focusSelf()
    }

    const previous = cursorCell()
    const nextRow = clamp(cursorRow() + rowDelta, 0, current.rowCount() - 1)
    const nextCol = clamp(cursorCol() + colDelta, 0, current.columnCount() - 1)
    const next = { kind: "body", row: dataRow(nextRow), col: gridCol(nextCol) } satisfies CellRef
    setCursorRow(nextRow)
    setCursorCol(nextCol)
    if (event?.shift) {
      setSelectionStart((start) => start ?? previous)
      setSelectionEnd(next)
    } else {
      clearSelection()
    }
    viewport.scrollCellIntoView(next)
  }

  const handleManualHorizontalScroll = (direction: "left" | "right") => {
    if (!grid()) return
    viewport.scrollHorizontally(direction === "left" ? -HORIZONTAL_SCROLL_STEP : HORIZONTAL_SCROLL_STEP)
    logDisplayedState("manual-horizontal-scroll", { direction })
  }

  const handleViewportChange = () => {
    const before = viewport.debugSnapshot()
    viewport.updateFromScrollbox()
    const after = viewport.debugSnapshot()
    logDisplayedState("viewport-change", { before, after })
    warnBrokenInvariants("viewport-change")
    if (selectionStart()) {
      processMouseDragSelection(viewport.nativeSelection())
    }
  }

  const handleUserScroll = (context: OriScrollboxUserScrollContext) => {
    logDisplayedState("user-scroll", {
      event: {
        type: context.event.type,
        x: context.event.x,
        y: context.event.y,
        scroll: context.event.scroll,
        isDragging: context.event.isDragging,
        button: context.event.button,
        modifiers: context.event.modifiers,
      },
      delta: context.delta,
      scrollLeft: context.scrollLeft,
      scrollTop: context.scrollTop,
    })
    warnBrokenInvariants("user-scroll")
  }

  const bindings: KeyBinding[] = [
    { pattern: "up", handler: (event) => moveSelection(-1, 0, event), preventDefault: true },
    { pattern: "k", handler: (event) => moveSelection(-1, 0, event), preventDefault: true },
    { pattern: "shift+up", handler: (event) => moveSelection(-1, 0, event), preventDefault: true },
    { pattern: "down", handler: (event) => moveSelection(1, 0, event), preventDefault: true },
    { pattern: "j", handler: (event) => moveSelection(1, 0, event), preventDefault: true },
    { pattern: "shift+down", handler: (event) => moveSelection(1, 0, event), preventDefault: true },
    { pattern: "left", handler: (event) => moveSelection(0, -1, event), preventDefault: true },
    { pattern: "h", handler: (event) => moveSelection(0, -1, event), preventDefault: true },
    { pattern: "shift+left", handler: (event) => moveSelection(0, -1, event), preventDefault: true },
    { pattern: ["ctrl+h", "backspace"], handler: () => handleManualHorizontalScroll("left"), preventDefault: true },
    { pattern: "right", handler: (event) => moveSelection(0, 1, event), preventDefault: true },
    { pattern: "l", handler: (event) => moveSelection(0, 1, event), preventDefault: true },
    { pattern: "shift+right", handler: (event) => moveSelection(0, 1, event), preventDefault: true },
    { pattern: "ctrl+l", handler: () => handleManualHorizontalScroll("right"), preventDefault: true },
    { pattern: "escape", handler: clearSelection, preventDefault: true },
  ]

  const startCellSelection = (cell: CellRef, event: MouseEvent) => {
    pane.focusSelf()
    event.preventDefault()
    setSelectionStart(cell)
    setSelectionEnd(null)
    if (cell.kind === "body") {
      setCursorRow(cell.row)
      setCursorCol(cell.col)
    }
    logDisplayedState("selection-mousedown", {
      cell: describeCell(cell),
      event: {
        type: event.type,
        x: event.x,
        y: event.y,
        button: event.button,
        isDragging: event.isDragging,
        modifiers: event.modifiers,
      },
    })
  }

  const SeparatorCell = (props: { selected?: boolean; bg?: string; fg?: string }) => (
    <table_cell
      width={1}
      display="│"
      fg={props.fg ?? theme().get("border")}
      defaultFg={theme().get("border")}
      backgroundColor={props.bg}
      attributes={TextAttributes.BOLD}
      selectionBg={theme().get("results_selection_background")}
      paddingLeft={0}
      paddingRight={0}
      selectable={false}
      selected={props.selected}
    />
  )

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

        <Show
          when={grid()}
          keyed
        >
          {(current: ResultsGrid) => (
            /* biome-ignore lint/a11y/noStaticElementInteractions: results panel focuses itself on mouse down */
            <box
              flexDirection="column"
              justifyContent="flex-start"
              flexGrow={1}
              onMouseDown={pane.focusSelf}
              paddingRight={1}
            >
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
                  width={rowNumberCellWidth()}
                  minWidth={rowNumberCellWidth()}
                  maxWidth={rowNumberCellWidth()}
                  flexShrink={0}
                >
                  <table_cell
                    width={rowNumberCellWidth()}
                    display=""
                    backgroundColor={theme().get("panel_background")}
                    fg={theme().get("panel_background")}
                    defaultFg={theme().get("panel_background")}
                    attributes={TextAttributes.DIM}
                    selectionBg={theme().get("results_selection_background")}
                    selectable={false}
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
                    marginLeft={-viewport.scrollLeft()}
                    backgroundColor={theme().get("results_header_background")}
                  >
                    <SeparatorCell
                      bg={theme().get("results_header_background")}
                      selected={current.isSeparatorSelected(selectedCells(), "header", null)}
                    />
                    {current.columns.map((column, columnIndex) => {
                      const col = () => gridCol(columnIndex)
                      const selected = () => current.isCellSelected(selectedCells(), { kind: "header", col: col() })
                      return [
                        columnIndex > 0 && (
                          <SeparatorCell
                            bg={theme().get("results_header_background")}
                            selected={current.isSeparatorSelected(selectedCells(), "header", gridCol(columnIndex - 1))}
                          />
                        ),

                        <table_cell
                          width={current.columnRanges[columnIndex]?.width ?? 1}
                          display={formatResultCell(column.name)}
                          backgroundColor={theme().get("results_header_background")}
                          fg={theme().get("results_column_title")}
                          defaultFg={theme().get("results_column_title")}
                          attributes={TextAttributes.BOLD}
                          selectionBg={theme().get("results_selection_background")}
                          value={String(column.name)}
                          selected={selected()}
                          onMouseDown={(event: MouseEvent) => startCellSelection({ kind: "header", col: col() }, event)}
                          onSelectionUpdate={(selection: OpenTuiSelection | null) => processMouseDragSelection(selection)}
                        />,
                      ]
                    })}
                    <SeparatorCell
                      bg={theme().get("results_header_background")}
                      selected={current.isTrailingSeparatorSelected(
                        selectedCells(),
                        "header",
                        gridCol(current.columnCount() - 1),
                      )}
                    />
                  </box>
                </box>
              </box>

              <box
                flexDirection="row"
                flexGrow={1}
              >
                <box
                  position="relative"
                  width={rowNumberCellWidth()}
                  minWidth={rowNumberCellWidth()}
                  maxWidth={rowNumberCellWidth()}
                  height="100%"
                  flexShrink={0}
                  backgroundColor={theme().get("panel_background")}
                  overflow="hidden"
                >
                  <Index each={viewport.visibleRows()}>
                    {(item) => {
                      const currentRow = () => item().row
                      const rowNumberColor = () =>
                        pane.isFocused() && cursorRow() === currentRow()
                          ? theme().get("results_row_number_cursor")
                          : theme().get("results_row_number")
                      return (
                        <box
                          position="absolute"
                          top={item().top - viewport.scrollTop()}
                          left={0}
                          flexDirection="row"
                          backgroundColor={theme().get("panel_background")}
                        >
                          <table_cell
                            width={rowNumberCellWidth()}
                            display={String(currentRow() + 1)}
                            align="right"
                            backgroundColor={theme().get("panel_background")}
                            fg={rowNumberColor()}
                            defaultFg={rowNumberColor()}
                            selectionBg={theme().get("results_selection_background")}
                            selectable={false}
                          />
                        </box>
                      )
                    }}
                  </Index>
                </box>
                <OriScrollbox
                  onReady={viewport.attach}
                  onViewportChange={handleViewportChange}
                  onUserScroll={handleUserScroll}
                  scrollSpeed={resultsScrollSpeed}
                  minHorizontalThumbWidth={5}
                  minVerticalThumbHeight={2}
                  flexGrow={1}
                  onMouseDown={pane.focusSelf}
                  contentOptions={{
                    maxWidth: undefined,
                    width: "auto",
                  }}
                >
                  <box
                    position="relative"
                    width={viewport.metricWidth()}
                    minWidth={viewport.metricWidth()}
                    maxWidth={viewport.metricWidth()}
                    height={viewport.metricHeight()}
                    minHeight={viewport.metricHeight()}
                    maxHeight={viewport.metricHeight()}
                  >
                    <box
                      width={viewport.metricWidth()}
                      minWidth={viewport.metricWidth()}
                      maxWidth={viewport.metricWidth()}
                      height={viewport.metricHeight()}
                      minHeight={viewport.metricHeight()}
                      maxHeight={viewport.metricHeight()}
                    />
                    <box
                      position="absolute"
                      top={0}
                      left={0}
                      width={current.totalWidth}
                      minWidth={current.totalWidth}
                      maxWidth={current.totalWidth}
                      height={viewport.metricHeight()}
                      minHeight={viewport.metricHeight()}
                      maxHeight={viewport.metricHeight()}
                    >
                      <For each={visibleRowIds()}>
                        {(row) => {
                          const currentRow = () => row
                          const rowBackground = () =>
                            currentRow() % 2 === 0
                              ? theme().get("panel_background")
                              : theme().get("results_row_alt_background")
                          const activeCursorCol = () =>
                            showCursor() && cursorRow() === currentRow() ? cursorCol() : -1

                          return (
                            <box
                              position="absolute"
                              top={current.rowVisualRange(currentRow()).top}
                              left={0}
                              flexDirection="row"
                              backgroundColor={rowBackground()}
                            >
                              <SeparatorCell
                                bg={activeCursorCol() === 0 ? cursorCellBackground() : rowBackground()}
                                fg={activeCursorCol() === 0 ? cursorCellBackground() : theme().get("border")}
                                selected={current.isSeparatorSelected(selectedCells(), currentRow(), null)}
                              />
                              {(current.rows[currentRow()] ?? []).map((cell, columnIndex) => {
                                const col = () => gridCol(columnIndex)
                                const isCursor = () => activeCursorCol() === columnIndex
                                const isCursorOnLeftCell = () => columnIndex > 0 && activeCursorCol() === columnIndex - 1
                                const selected = () =>
                                  current.isCellSelected(selectedCells(), {
                                    kind: "body",
                                    row: currentRow(),
                                    col: col(),
                                  })
                                return [
                                  columnIndex > 0 && (
                                    <SeparatorCell
                                      bg={isCursor() || isCursorOnLeftCell() ? cursorCellBackground() : undefined}
                                      fg={
                                        isCursor() || isCursorOnLeftCell() ? cursorCellBackground() : theme().get("border")
                                      }
                                      selected={current.isSeparatorSelected(
                                        selectedCells(),
                                        currentRow(),
                                        gridCol(columnIndex - 1),
                                      )}
                                    />
                                  ),
                                  <table_cell
                                    backgroundColor={isCursor() ? cursorCellBackground() : undefined}
                                    flexDirection="row"
                                    width={current.columnRanges[columnIndex]?.width ?? 1}
                                    align={typeof cell === "number" ? "right" : "left"}
                                    onMouseDown={(event: MouseEvent) =>
                                      startCellSelection({ kind: "body", row: currentRow(), col: col() }, event)
                                    }
                                    selectionBg={theme().get("results_selection_background")}
                                    value={formatResultCell(cell)}
                                    display={formatResultCell(cell)}
                                    fg={isCursor() ? theme().get("selection_foreground") : theme().get("text")}
                                    defaultFg={theme().get("text")}
                                    selected={selected()}
                                    onSelectionUpdate={(selection: OpenTuiSelection | null) =>
                                      processMouseDragSelection(selection)
                                    }
                                  />,
                                  columnIndex === (current.rows[currentRow()]?.length ?? 0) - 1 && (
                                    <SeparatorCell
                                      bg={isCursor() ? cursorCellBackground() : undefined}
                                      fg={isCursor() ? cursorCellBackground() : theme().get("border")}
                                      selected={current.isTrailingSeparatorSelected(selectedCells(), currentRow(), col())}
                                    />
                                  ),
                                ]
                              })}
                            </box>
                          )
                        }}
                      </For>
                    </box>
                  </box>
                </OriScrollbox>
              </box>
            </box>
          )}
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
