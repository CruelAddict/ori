import type { ScrollBoxRenderable } from "@opentui/core"
import { getViewportRect, OriScrollbox, scrollIntoView } from "@ui/components/ori-scrollbox"
import { type Accessor, createEffect, createMemo, on, onCleanup, type ParentProps } from "solid-js"

const explorerScrollSpeed = {
  horizontal: 3,
  vertical: 1,
}

export type RowDescriptor = {
  id: string
  depth: number
}

const ROW_LEFT_PADDING = 2
const ROW_DEPTH_STEP = 2

export type ScrollDelta = { x: number; y: number }

export type ExplorerScrollboxApi = {
  scrollBy(delta: ScrollDelta): void
}

interface ExplorerScrollboxProps extends ParentProps {
  rows: Accessor<readonly RowDescriptor[]>
  selectedRowId: Accessor<string | null>
  onApiReady?: (api: ExplorerScrollboxApi | undefined) => void
}

export function ExplorerScrollbox(props: ExplorerScrollboxProps) {
  let scrollBoxRef: ScrollBoxRenderable | undefined

  const selectedRow = createMemo(() => {
    const rowId = props.selectedRowId()
    if (!rowId) return null
    const rows = props.rows()
    const index = rows.findIndex((row) => row.id === rowId)
    if (index < 0) return null
    return { index, depth: rows[index].depth }
  })

  const ensureSelectedVisible = () => {
    const row = selectedRow()
    if (!row || !scrollBoxRef) return
    const viewport = getViewportRect(scrollBoxRef)
    if (!viewport) return
    scrollIntoView(
      scrollBoxRef,
      {
        x: viewport.x + ROW_LEFT_PADDING + row.depth * ROW_DEPTH_STEP - scrollBoxRef.scrollLeft,
        y: viewport.y + row.index - scrollBoxRef.scrollTop,
      },
      { trackX: true },
    )
  }

  createEffect(on(selectedRow, ensureSelectedVisible, { defer: true }))

  props.onApiReady?.({ scrollBy: (delta) => scrollBoxRef?.scrollBy(delta) })
  onCleanup(() => props.onApiReady?.(undefined))

  return (
    <OriScrollbox
      onReady={(node) => {
        scrollBoxRef = node
        ensureSelectedVisible()
      }}
      onSync={ensureSelectedVisible}
      scrollSpeed={explorerScrollSpeed}
      minHorizontalThumbWidth={5}
      height="100%"
      contentOptions={{ maxWidth: undefined, width: "auto", minHeight: "100%", flexGrow: 1, flexShrink: 0 }}
    >
      <box
        flexDirection="column"
        alignItems="stretch"
        width="auto"
        minHeight="100%"
      >
        {props.children}
      </box>
    </OriScrollbox>
  )
}
