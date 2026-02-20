import type { BoxRenderable, ScrollBoxRenderable } from "@opentui/core"
import { OriScrollbox } from "@ui/components/ori-scrollbox"
import { type Accessor, createContext, createEffect, onCleanup, type ParentProps, useContext } from "solid-js"
import { createAutoscrollService, type ScrollDelta } from "./explorer-scroll/autoscroll-service.ts"

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

function useExplorerAutoscroll(rows: Accessor<readonly RowDescriptor[]>, selectedRowId: Accessor<string | null>) {
  const autoscroll = createAutoscrollService()
  createEffect(() => {
    rows()
    autoscroll.ensureRowVisible(selectedRowId())
  })
  onCleanup(() => autoscroll.dispose())
  return autoscroll
}

export function useExplorerScrollRegistration() {
  const ctx = useContext(ExplorerScrollboxContext)
  if (!ctx) throw new Error("useExplorerScrollRegistration must be used within an ExplorerScrollbox")
  return ctx.registerRowNode
}

export type ExplorerScrollboxApi = {
  scrollBy(delta: ScrollDelta): void
  ensureRowVisible(rowId: string | null): void
}

interface ExplorerScrollboxProps extends ParentProps {
  rows: Accessor<readonly RowDescriptor[]>
  selectedRowId: Accessor<string | null>
  onApiReady?: (api: ExplorerScrollboxApi | undefined) => void
}

export function ExplorerScrollbox(props: ExplorerScrollboxProps) {
  const autoscroll = useExplorerAutoscroll(props.rows, props.selectedRowId)

  props.onApiReady?.({ scrollBy: autoscroll.scrollBy, ensureRowVisible: autoscroll.ensureRowVisible })
  onCleanup(() => {
    props.onApiReady?.(undefined)
  })

  const handleScrollboxRef = (node: ScrollBoxRenderable | undefined) => {
    autoscroll.setScrollBox(node)
  }

  const contextValue: ExplorerScrollboxContextValue = {
    registerRowNode: autoscroll.registerRowNode,
  }

  return (
    <OriScrollbox
      onReady={handleScrollboxRef}
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

export type { ScrollDelta }
