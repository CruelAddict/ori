import { useTheme } from "@app/providers/theme"
import type { BoxRenderable, MouseEvent, ScrollBoxRenderable } from "@opentui/core"
import { enforceHorizontalScrollbarMinThumbWidth } from "@shared/lib/opentui-scrollbar-min-width"
import { createScrollSpeedHandler } from "@shared/lib/scroll-speed"
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
  let scrollBox: ScrollBoxRenderable | undefined
  const { theme } = useTheme()

  const autoscroll = useExplorerAutoscroll(props.rows, props.selectedRowId)

  props.onApiReady?.({ scrollBy: autoscroll.scrollBy, ensureRowVisible: autoscroll.ensureRowVisible })
  onCleanup(() => {
    props.onApiReady?.(undefined)
  })

  const handleScrollboxRef = (node: ScrollBoxRenderable | undefined) => {
    scrollBox = node
    autoscroll.setScrollBox(node)
    if (!scrollBox) return
    enforceHorizontalScrollbarMinThumbWidth(scrollBox, 5)
    // @ts-expect-error onMouseEvent is protected in typings
    const originalOnMouseEvent = scrollBox.onMouseEvent?.bind(scrollBox)
    const handleMouseEvent = createScrollSpeedHandler(originalOnMouseEvent, explorerScrollSpeed)
    // @ts-expect-error override protected handler to apply scroll speed
    scrollBox.onMouseEvent = (event: MouseEvent) => {
      handleMouseEvent(event)
    }
  }

  const contextValue: ExplorerScrollboxContextValue = {
    registerRowNode: autoscroll.registerRowNode,
  }

  return (
    <scrollbox
      ref={handleScrollboxRef}
      height="100%"
      scrollY={true}
      scrollX={true}
      contentOptions={{
        maxWidth: undefined,
        width: "auto",
        minHeight: "100%",
        flexGrow: 1,
        flexShrink: 0,
      }}
      horizontalScrollbarOptions={{
        trackOptions: {
          foregroundColor: theme().get("scrollbar_foreground"),
          backgroundColor: theme().get("scrollbar_background"),
        },
      }}
      verticalScrollbarOptions={{
        trackOptions: {
          foregroundColor: theme().get("scrollbar_foreground"),
          backgroundColor: theme().get("scrollbar_background"),
        },
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
    </scrollbox>
  )
}

export type { ScrollDelta }
