import type { BoxRenderable, MouseEvent, ScrollBoxRenderable } from "@opentui/core"
import { enforceHorizontalScrollbarMinThumbWidth } from "@shared/lib/opentui-scrollbar-min-width"
import { createScrollSpeedHandler } from "@shared/lib/scroll-speed"
import { type Accessor, createContext, createEffect, onCleanup, type ParentProps, useContext } from "solid-js"
import { createAutoscrollService } from "./tree-scroll/autoscroll-service.ts"
import type { ScrollDelta } from "./tree-scroll/types.ts"
import { useTheme } from "@app/providers/theme.tsx"

type TreeScrollboxContextValue = {
  registerRowNode: (rowId: string, node: BoxRenderable | undefined) => void
}

const TreeScrollboxContext = createContext<TreeScrollboxContextValue | null>(null)

const treeScrollSpeed = {
  horizontal: 3,
  vertical: 1,
}

export type RowDescriptor = {
  id: string
  depth: number
}

function useTreeAutoscroll(rows: Accessor<readonly RowDescriptor[]>, selectedRowId: Accessor<string | null>) {
  const autoscroll = createAutoscrollService()
  createEffect(() => {
    rows()
    autoscroll.ensureRowVisible(selectedRowId())
  })
  onCleanup(() => autoscroll.dispose())
  return autoscroll
}

export function useTreeScrollRegistration() {
  const ctx = useContext(TreeScrollboxContext)
  if (!ctx) throw new Error("useTreeScrollRegistration must be used within a TreeScrollbox")
  return ctx.registerRowNode
}

export type TreeScrollboxApi = {
  scrollBy(delta: ScrollDelta): void
  ensureRowVisible(rowId: string | null): void
}

interface TreeScrollboxProps extends ParentProps {
  rows: Accessor<readonly RowDescriptor[]>
  selectedRowId: Accessor<string | null>
  onApiReady?: (api: TreeScrollboxApi | undefined) => void
}

export function TreeScrollbox(props: TreeScrollboxProps) {
  let scrollBox: ScrollBoxRenderable | undefined

  const autoscroll = useTreeAutoscroll(props.rows, props.selectedRowId)

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
    const handleMouseEvent = createScrollSpeedHandler(originalOnMouseEvent, treeScrollSpeed)
    // @ts-expect-error override protected handler to apply scroll speed
    scrollBox.onMouseEvent = (event: MouseEvent) => {
      handleMouseEvent(event)
    }
  }

  const contextValue: TreeScrollboxContextValue = {
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
        flexShrink: 0
      }}
      verticalScrollbarOptions={{
        trackOptions: {
          backgroundColor: useTheme().theme().backgroundPanel,
        },
      }}
      horizontalScrollbarOptions={{
        trackOptions: {
          backgroundColor: useTheme().theme().backgroundPanel,
        },
      }}
    >
      <TreeScrollboxContext.Provider value={contextValue}>
        <box
          flexDirection="column"
          alignItems="flex-start"
          width="auto"
          minHeight={"100%"}
        >
          {props.children}
        </box>
      </TreeScrollboxContext.Provider>
    </scrollbox>
  )
}

export type { ScrollDelta }
