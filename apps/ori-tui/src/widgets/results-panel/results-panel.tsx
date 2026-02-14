import { useTheme } from "@app/providers/theme"
import {
  type BoxRenderable,
  type KeyEvent,
  type MouseEvent,
  type ScrollBoxRenderable,
  TextAttributes,
} from "@opentui/core"
import "./table-cell"
import { setSelectionOverride } from "@shared/lib/clipboard"
import { enforceHorizontalScrollbarMinThumbWidth } from "@shared/lib/opentui-scrollbar-min-width"
import { createScrollSpeedHandler } from "@shared/lib/scroll-speed"
import { type KeyBinding, KeyScope } from "@src/core/services/key-scopes"
import type { ResultsPaneViewModel } from "@src/features/results-pane/use-results-pane"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"

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
  const job = () => pane.job()
  const { theme } = useTheme()
  const palette = theme

  let scrollRef: ScrollBoxRenderable | undefined
  const rowRenderables = new Map<number, BoxRenderable>()

  const [scrollLeft, setScrollLeft] = createSignal(0)

  const [cursorRow, setCursorRow] = createSignal(0)
  const [cursorCol, setCursorCol] = createSignal(0)
  const [selectionCount, setSelectionCount] = createSignal(0)

  const selectedHeaderCols = new Set<number>()
  const selectedRowCols = new Map<number, Set<number>>()

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

  const ensureColumnVisible = (colIndex: number, direction: "left" | "right") => {
    if (!scrollRef) return
    const viewport = getViewport()
    if (!viewport) return

    const widths = columnWidths()
    // Calculate the x position of the column (sum of previous column widths + separators)
    let colLeft = 1 // Initial separator
    for (let i = 0; i < colIndex; i++) {
      colLeft += widths[i] + 2 + 1 // width + padding + separator
    }
    const colWidth = widths[colIndex] + 2
    const colRight = colLeft + colWidth

    const viewportWidth = viewport.width ?? 0
    const currentScrollLeft = scrollRef.scrollLeft ?? 0
    const viewportLeft = currentScrollLeft
    const viewportRight = currentScrollLeft + viewportWidth

    if (colRight > viewportRight) {
      const delta = colRight - viewportRight
      scrollRef.scrollBy({ x: delta, y: 0 })
      setScrollLeft(scrollRef.scrollLeft ?? 0)
    } else if (colLeft < viewportLeft) {
      const delta = colLeft - viewportLeft
      scrollRef.scrollBy({ x: delta, y: 0 })
      setScrollLeft(scrollRef.scrollLeft ?? 0)
    }
  }

  const handleManualHorizontalScroll = (direction: "left" | "right") => {
    if (!hasResults()) return
    const delta = direction === "left" ? -HORIZONTAL_SCROLL_STEP : HORIZONTAL_SCROLL_STEP
    scrollRef?.scrollBy({ x: delta, y: 0 })
    setScrollLeft(scrollRef?.scrollLeft ?? 0)
  }

  const hasResultData = () => hasResults() && job()?.result
  const isActive = () => pane.isFocused()
  const hasSelection = () => selectionCount() > 0
  const cursorCellBackground = createMemo(() => palette().primary)

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
      fg={props.fg ?? palette().border}
      backgroundColor={props.bg}
      attributes={TextAttributes.BOLD}
      selectionBg={props.selectionBg}
      paddingLeft={0}
      paddingRight={0}
    />
  )

  const resetSelection = () => {
    setCursorRow(0)
    setCursorCol(0)
    setSelectionCount(0)
    setScrollLeft(0)
    selectedHeaderCols.clear()
    selectedRowCols.clear()
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
    const result = job()?.result
    if (!result) return

    const nextRow = clamp(cursorRow() + rowDelta, 0, resultRows().length - 1)
    const nextCol = clamp(cursorCol() + colDelta, 0, resultColumns().length - 1)

    setCursorRow(nextRow)
    setCursorCol(nextCol)
    ensureRowVisible(nextRow)
    if (colDelta !== 0) {
      ensureColumnVisible(nextCol, colDelta < 0 ? "left" : "right")
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
    ensureRowVisible(rowIndex)
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
        backgroundColor={palette().backgroundPanel}
        marginTop={1}
        gap={0}
        minHeight={18}
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
            <box overflow="hidden">
              <box
                flexDirection="row"
                marginLeft={-scrollLeft()}
                backgroundColor={palette().resultsHeaderBackground}
              >
                <SeparatorCell
                  fg={palette().border}
                  bg={palette().resultsHeaderBackground}
                  selectionBg={palette().backgroundElement}
                />
                <For each={resultColumns()}>
                  {(column, index) => (
                    <>
                      {index() > 0 && (
                        <SeparatorCell
                          fg={palette().border}
                          bg={palette().resultsHeaderBackground}
                          selectionBg={palette().backgroundElement}
                        />
                      )}

                      <table_cell
                        width={columnWidths()[index()] + 2}
                        display={formatCell(column.name, columnWidths()[index()])}
                        backgroundColor={palette().resultsHeaderBackground}
                        fg={palette().accent}
                        attributes={TextAttributes.BOLD}
                        selectionBg={palette().backgroundElement}
                        value={String(column.name)}
                        onSelectionChange={(selected: boolean) => handleHeaderSelectionChange(index(), selected)}
                      />
                    </>
                  )}
                </For>
                <SeparatorCell
                  fg={palette().border}
                  bg={palette().resultsHeaderBackground}
                  selectionBg={palette().backgroundElement}
                />
              </box>
            </box>
            {/* Rows */}
            <scrollbox
              ref={(node: ScrollBoxRenderable | undefined) => {
                scrollRef = node ?? undefined
                if (!scrollRef) return
                // @ts-expect-error onMouseEvent is protected in typings
                const originalOnMouseEvent = scrollRef.onMouseEvent?.bind(scrollRef)
                const handleMouseEvent = createScrollSpeedHandler(originalOnMouseEvent, resultsScrollSpeed)
                // @ts-expect-error override protected handler to track horizontal scroll
                scrollRef.onMouseEvent = (event: MouseEvent) => {
                  handleMouseEvent(event)
                  setScrollLeft(scrollRef?.scrollLeft ?? 0)
                }
                enforceHorizontalScrollbarMinThumbWidth(scrollRef, 5)
              }}
              maxHeight={18}
              onMouseDown={pane.focusSelf}
              scrollX={true}
              scrollY={true}
              horizontalScrollbarOptions={{
                trackOptions: {
                  foregroundColor: theme().text,
                  backgroundColor: theme().backgroundPanel,
                },
              }}
              verticalScrollbarOptions={{
                trackOptions: {
                  foregroundColor: theme().text,
                  backgroundColor: theme().backgroundPanel,
                },
              }}
              marginBottom={1}
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
                      rowIndex() % 2 === 0 ? palette().backgroundPanel : palette().resultsRowAltBackground
                    return (
                      <box
                        flexDirection="row"
                        backgroundColor={rowBackground()}
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
                            const isCursor = () =>
                              isActive() && cursorRow() === rowIndex() && cursorCol() === colIndex()
                            const isCursorOnLeftCell = () =>
                              colIndex() > 0 &&
                              isActive() &&
                              cursorRow() === rowIndex() &&
                              cursorCol() === colIndex() - 1
                            const cursorBackground = () => cursorCellBackground()
                            return (
                              <>
                                <SeparatorCell
                                  bg={isCursor() || isCursorOnLeftCell() ? cursorBackground() : undefined}
                                  fg={isCursor() || isCursorOnLeftCell() ? cursorBackground() : palette().border}
                                  selectionBg={palette().backgroundElement}
                                />
                                <table_cell
                                  backgroundColor={isCursor() ? cursorBackground() : undefined}
                                  flexDirection="row"
                                  width={columnWidths()[colIndex()] + 2}
                                  align={typeof cell === "number" ? "right" : "left"}
                                  onMouseDown={(event: MouseEvent) =>
                                    handleCellMouseDown(rowIndex(), colIndex(), event)
                                  }
                                  selectionBg={palette().backgroundElement}
                                  value={String(cell)}
                                  display={formatCell(cell, columnWidths()[colIndex()])}
                                  fg={isCursor() && !hasSelection() ? palette().background : palette().text}
                                  onSelectionChange={(selected: boolean) =>
                                    handleRowSelectionChange(rowIndex(), colIndex(), selected)
                                  }
                                />
                                {colIndex() === row.length - 1 && (
                                  <SeparatorCell
                                    bg={isCursor() ? cursorBackground() : undefined}
                                    fg={isCursor() ? cursorBackground() : palette().border}
                                    selectionBg={palette().backgroundElement}
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
            </scrollbox>
          </box>
        </Show>

        <Show when={job()?.status === "success" && !hasResults()}>
          <text attributes={TextAttributes.DIM}>
            Query completed successfully in
            {job()?.durationMs ? ` ${job()?.durationMs}ms` : ""}
            {rowsAffected() !== undefined ? `; ${rowsAffected()} rows affected` : ""}
          </text>
        </Show>
      </box>
    </KeyScope>
  )
}
