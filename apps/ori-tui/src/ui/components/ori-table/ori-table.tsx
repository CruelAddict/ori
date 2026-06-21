import { type MouseEvent, type Selection as OpenTuiSelection, TextAttributes } from "@opentui/core"
import { OriScrollbox } from "@ui/components/ori-scrollbox"
import { KeyScope } from "@ui/services/key-scopes"
import type { Accessor } from "solid-js"
import { For, Index } from "solid-js"
import { createOriTableVM, type OriTableColumn } from "./ori-table-vm"
import "./table-cell"

export type OriTableColors = {
  background: string
  alternateRowBackground: string
  headerBackground: string
  headerText: string
  rowNumber: string
  cursorRowNumber: string
  border: string
  cursorBackground: string
  cursorForeground: string
  text: string
  selectionBackground: string
}

export type OriTableProps = {
  columns: OriTableColumn[]
  rows: unknown[][]
  colors: OriTableColors
  isFocused: Accessor<boolean>
  focusSelf: () => void
}

const scrollSpeed = {
  horizontal: 4,
  vertical: 2,
}

export function OriTable(props: OriTableProps) {
  const table = createOriTableVM({
    columns: () => props.columns,
    rows: () => props.rows,
    isFocused: props.isFocused,
    focusSelf: props.focusSelf,
  })

  const SeparatorCell = (cellProps: { selected?: boolean; bg?: string; fg?: string }) => (
    <table_cell
      width={1}
      display="│"
      fg={cellProps.fg ?? props.colors.border}
      defaultFg={props.colors.border}
      backgroundColor={cellProps.bg}
      attributes={TextAttributes.BOLD}
      selectionBg={props.colors.selectionBackground}
      paddingLeft={0}
      paddingRight={0}
      selectable={false}
      selected={cellProps.selected}
    />
  )

  return (
    <KeyScope
      bindings={table.keyBindings()}
      enabled={props.isFocused}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: table focuses itself on mouse down */}
      <box
        flexDirection="column"
        justifyContent="flex-start"
        flexGrow={1}
        onMouseDown={props.focusSelf}
        onMouseUp={table.handleMouseUp}
        onMouseDragEnd={table.handleMouseUp}
        paddingRight={1}
      >
        <box
          flexDirection="row"
          overflow="hidden"
          backgroundColor={props.colors.headerBackground}
          minHeight={1}
        >
          <box
            flexDirection="row"
            backgroundColor={props.colors.background}
            zIndex={1}
            width={table.rowNumberCellWidth()}
            minWidth={table.rowNumberCellWidth()}
            maxWidth={table.rowNumberCellWidth()}
            flexShrink={0}
          >
            <table_cell
              width={table.rowNumberCellWidth()}
              display=""
              backgroundColor={props.colors.background}
              fg={props.colors.background}
              defaultFg={props.colors.background}
              attributes={TextAttributes.DIM}
              selectionBg={props.colors.selectionBackground}
              selectable={false}
            />
          </box>
          <box
            flexGrow={1}
            flexShrink={1}
            minWidth={0}
            overflow="hidden"
            backgroundColor={props.colors.headerBackground}
          >
            <box
              flexDirection="row"
              marginLeft={-table.scrollLeft()}
              backgroundColor={props.colors.headerBackground}
            >
              <For each={table.headerSegments()}>
                {(segment) => {
                  if (segment.kind === "separator") {
                    return (
                      <SeparatorCell
                        bg={props.colors.headerBackground}
                        selected={table.isSeparatorSelected("header", segment.ref)}
                      />
                    )
                  }

                  const cell = segment.cell
                  return (
                    /* biome-ignore lint/a11y/noStaticElementInteractions: table cell starts drag selection */
                    <table_cell
                      width={segment.width}
                      display={table.headerText(cell.col)}
                      backgroundColor={props.colors.headerBackground}
                      fg={props.colors.headerText}
                      defaultFg={props.colors.headerText}
                      attributes={TextAttributes.BOLD}
                      selectionBg={props.colors.selectionBackground}
                      value={table.headerText(cell.col)}
                      selected={table.isCellSelected(cell)}
                      onMouseDown={(event: MouseEvent) => table.handleCellMouseDown(cell, event)}
                      onSelectionUpdate={(selection: OpenTuiSelection | null) =>
                        table.handleNativeSelectionUpdate(selection)
                      }
                    />
                  )
                }}
              </For>
            </box>
          </box>
        </box>

        <box
          flexDirection="row"
          flexGrow={1}
        >
          <box
            position="relative"
            width={table.rowNumberCellWidth()}
            minWidth={table.rowNumberCellWidth()}
            maxWidth={table.rowNumberCellWidth()}
            height="100%"
            flexShrink={0}
            backgroundColor={props.colors.background}
            overflow="hidden"
          >
            <Index each={table.visibleRows()}>
              {(item) => {
                const currentRow = () => item().row
                const rowNumberColor = () =>
                  props.isFocused() && table.cursorRow() === currentRow()
                    ? props.colors.cursorRowNumber
                    : props.colors.rowNumber
                return (
                  <box
                    position="absolute"
                    top={item().top - table.scrollTop()}
                    left={0}
                    flexDirection="row"
                    backgroundColor={props.colors.background}
                  >
                    <table_cell
                      width={table.rowNumberCellWidth()}
                      display={String(currentRow() + 1)}
                      align="right"
                      backgroundColor={props.colors.background}
                      fg={rowNumberColor()}
                      defaultFg={rowNumberColor()}
                      selectionBg={props.colors.selectionBackground}
                      selectable={false}
                    />
                  </box>
                )
              }}
            </Index>
          </box>
          <OriScrollbox
            onReady={table.attachScrollbox}
            onViewportChange={table.handleViewportChange}
            scrollSpeed={scrollSpeed}
            minHorizontalThumbWidth={5}
            minVerticalThumbHeight={2}
            flexGrow={1}
            onMouseDown={props.focusSelf}
            contentOptions={{
              maxWidth: undefined,
              width: "auto",
            }}
          >
            <box
              position="relative"
              width={table.contentWidth()}
              minWidth={table.contentWidth()}
              maxWidth={table.contentWidth()}
              height={table.contentHeight()}
              minHeight={table.contentHeight()}
              maxHeight={table.contentHeight()}
            >
              <box
                width={table.contentWidth()}
                minWidth={table.contentWidth()}
                maxWidth={table.contentWidth()}
                height={table.contentHeight()}
                minHeight={table.contentHeight()}
                maxHeight={table.contentHeight()}
              />
              <box
                position="absolute"
                top={0}
                left={0}
                width={table.contentWidth()}
                minWidth={table.contentWidth()}
                maxWidth={table.contentWidth()}
                height={table.contentHeight()}
                minHeight={table.contentHeight()}
                maxHeight={table.contentHeight()}
              >
                <For each={table.visibleRows().map((item) => item.row)}>
                  {(row) => {
                    const currentRow = () => row
                    const background = () =>
                      currentRow() % 2 === 0 ? props.colors.background : props.colors.alternateRowBackground
                    return (
                      <box
                        position="absolute"
                        top={table.rowVisualRange(currentRow()).top}
                        left={0}
                        flexDirection="row"
                        backgroundColor={background()}
                      >
                        <For each={table.rowSegments(currentRow())}>
                          {(segment) => {
                            if (segment.kind === "separator") {
                              const cursor = () => table.isCursorSeparator(currentRow(), segment.ref)
                              return (
                                <SeparatorCell
                                  bg={cursor() ? props.colors.cursorBackground : background()}
                                  fg={cursor() ? props.colors.cursorBackground : props.colors.border}
                                  selected={table.isSeparatorSelected(currentRow(), segment.ref)}
                                />
                              )
                            }

                            const cell = segment.cell
                            const cursor = () => table.isCursorCell(cell)
                            const value = () => (cell.kind === "body" ? table.cellValue(cell.row, cell.col) : undefined)
                            const display = () => (cell.kind === "body" ? table.cellText(cell.row, cell.col) : "")
                            return (
                              /* biome-ignore lint/a11y/noStaticElementInteractions: table cell starts drag selection */
                              <table_cell
                                backgroundColor={cursor() ? props.colors.cursorBackground : background()}
                                flexDirection="row"
                                width={segment.width}
                                align={typeof value() === "number" ? "right" : "left"}
                                onMouseDown={(event: MouseEvent) => table.handleCellMouseDown(cell, event)}
                                selectionBg={props.colors.selectionBackground}
                                value={display()}
                                display={display()}
                                fg={cursor() ? props.colors.cursorForeground : props.colors.text}
                                defaultFg={props.colors.text}
                                selected={table.isCellSelected(cell)}
                                onSelectionUpdate={(selection: OpenTuiSelection | null) =>
                                  table.handleNativeSelectionUpdate(selection)
                                }
                              />
                            )
                          }}
                        </For>
                      </box>
                    )
                  }}
                </For>
              </box>
            </box>
          </OriScrollbox>
        </box>
      </box>
    </KeyScope>
  )
}
