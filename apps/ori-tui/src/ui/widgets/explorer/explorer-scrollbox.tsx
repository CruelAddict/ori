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
  let viewportSize: { width: number; height: number } | null = null

  const selectedRow = createMemo<{ index: number; depth: number } | null>(() => {
    const rowId = props.selectedRowId()
    if (!rowId) {
      return null
    }
    const rows = props.rows()
    const index = rows.findIndex((row) => row.id === rowId)
    if (index < 0) {
      return null
    }
    const row = rows[index]
    if (!row || !Number.isFinite(row.depth)) {
      return null
    }
    return {
      index,
      depth: row.depth,
    }
  })

  const ensureSelectedVisible = () => {
    const row = selectedRow()
    if (!row) {
      return
    }
    const viewport = getViewportRect(scrollBoxRef)
    if (!viewport) {
      return
    }
    const scrollTop = scrollBoxRef?.scrollTop
    if (scrollTop === undefined || !Number.isFinite(scrollTop)) {
      return
    }
    const scrollLeft = scrollBoxRef?.scrollLeft
    if (scrollLeft === undefined || !Number.isFinite(scrollLeft)) {
      return
    }
    const targetY = viewport.y + row.index - scrollTop
    const rowStart = ROW_LEFT_PADDING + row.depth * ROW_DEPTH_STEP
    const targetX = viewport.x + rowStart - scrollLeft
    scrollIntoView(
      scrollBoxRef,
      {
        x: targetX,
        y: targetY,
      },
      {
        trackX: true,
      },
    )
  }

  createEffect(
    on(
      selectedRow,
      (row: { index: number; depth: number } | null) => {
        if (!row) {
          return
        }
        ensureSelectedVisible()
      },
      { defer: true },
    ),
  )

  props.onApiReady?.({
    scrollBy: (delta) => {
      scrollBoxRef?.scrollBy(delta)
    },
  })
  onCleanup(() => {
    props.onApiReady?.(undefined)
  })

  const handleScrollboxRef = (node: ScrollBoxRenderable | undefined) => {
    scrollBoxRef = node
    const viewport = getViewportRect(node)
    viewportSize = viewport
      ? {
        width: viewport.width,
        height: viewport.height,
      }
      : null
    ensureSelectedVisible()
  }

  const handleSync = () => {
    const viewport = getViewportRect(scrollBoxRef)
    if (!viewport) {
      viewportSize = null
      return
    }
    if (viewportSize && viewportSize.width === viewport.width && viewportSize.height === viewport.height) {
      return
    }
    viewportSize = {
      width: viewport.width,
      height: viewport.height,
    }
    ensureSelectedVisible()
  }

  return (
    <OriScrollbox
      onReady={handleScrollboxRef}
      onSync={handleSync}
      scrollSpeed={explorerScrollSpeed}
      minHorizontalThumbWidth={5}
      height="100%"
      contentOptions={{
        maxWidth: undefined,
        width: "auto",
        minHeight: "100%",
        flexGrow: 1,
        flexShrink: 0,
      }}
    >
      <box
        flexDirection="column"
        alignItems="stretch"
        width="auto"
        minHeight={"100%"}
      >
        {props.children}
      </box>
    </OriScrollbox>
  )
}
