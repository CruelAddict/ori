import type { BoxRenderable, ScrollBoxRenderable } from "@opentui/core"
import { type FollowPoint, OriScrollbox } from "@ui/components/ori-scrollbox"
import { cursorScrolloffY } from "@ui/services/scroll-follow-settings"
import { type Accessor, createContext, createSignal, onCleanup, type ParentProps, useContext } from "solid-js"

type ExplorerScrollboxContextValue = {
  registerRowNode: (rowId: string, node: BoxRenderable | undefined) => void
}

const ExplorerScrollboxContext = createContext<ExplorerScrollboxContextValue | null>(null)

const explorerScrollSpeed = {
  horizontal: 3,
  vertical: 1,
}

export type RowDescriptor = {
  id: string
  depth: number
}

const EXPLORER_TEXT_LEFT_PADDING = 2
const EXPLORER_DEPTH_STEP = 2

export function useExplorerScrollRegistration() {
  const ctx = useContext(ExplorerScrollboxContext)
  if (!ctx) throw new Error("useExplorerScrollRegistration must be used within an ExplorerScrollbox")
  return ctx.registerRowNode
}

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
  const [rowVersion, setRowVersion] = createSignal(0)
  const rowNodes = new Map<string, BoxRenderable>()
  let scrollBoxRef: ScrollBoxRenderable | undefined

  const registerRowNode = (rowId: string, node: BoxRenderable | undefined) => {
    if (!node) {
      rowNodes.delete(rowId)
      setRowVersion((value) => value + 1)
      return
    }
    rowNodes.set(rowId, node)
    setRowVersion((value) => value + 1)
  }

  const target = (): FollowPoint | null => {
    const rows = props.rows()
    rowVersion()
    const rowId = props.selectedRowId()
    if (!rowId) {
      return null
    }
    const node = rowNodes.get(rowId)
    if (!node) {
      return null
    }
    const row = rows.find((value) => value.id === rowId)
    if (!row) {
      return null
    }
    if (node.x === undefined || node.y === undefined) {
      return null
    }
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) {
      return null
    }
    if (!Number.isFinite(row.depth)) {
      return null
    }
    const depth = row.depth
    return {
      x: node.x + EXPLORER_TEXT_LEFT_PADDING + depth * EXPLORER_DEPTH_STEP,
      y: node.y,
    }
  }

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
  }

  const contextValue: ExplorerScrollboxContextValue = {
    registerRowNode,
  }

  return (
    <OriScrollbox
      onReady={handleScrollboxRef}
      follow={{
        target,
        scrolloffY: cursorScrolloffY,
      }}
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
      <ExplorerScrollboxContext.Provider value={contextValue}>
        <box
          flexDirection="column"
          alignItems="stretch"
          width="auto"
          minHeight={"100%"}
        >
          {props.children}
        </box>
      </ExplorerScrollboxContext.Provider>
    </OriScrollbox>
  )
}
