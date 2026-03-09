import type { ScrollBoxRenderable } from "@opentui/core"
import { TextAttributes } from "@opentui/core"
import { getViewportRect, OriScrollbox, scrollIntoView } from "@ui/components/ori-scrollbox"
import { useTheme } from "@ui/providers/theme"
import { type KeyBinding, KeyScope } from "@ui/services/key-scopes"
import { type Accessor, createEffect, createSelector, For, on, Show } from "solid-js"
import { ExplorerRow } from "./explorer-row.tsx"
import type { ExplorerViewModel } from "./view-model/create-vm"

const HORIZONTAL_SCROLL_STEP = 6
const ROW_LEFT_PADDING = 2
const ROW_DEPTH_STEP = 2

export type ExplorerProps = {
  viewModel: ExplorerViewModel
}

export function Explorer(props: ExplorerProps) {
  const explorer = props.viewModel
  const rootIds = explorer.controller.rootIds
  const rows = explorer.controller.visibleRows
  const selectedId = explorer.controller.selectedId
  const isRowSelected = createSelector(selectedId)
  const { theme } = useTheme()

  let scrollBoxRef: ScrollBoxRenderable | undefined

  const ensureSelectedVisible = () => {
    const selected = selectedId()
    if (!selected || !scrollBoxRef) return
    const rowsList = rows()
    const index = rowsList.findIndex((row) => row.id === selected)
    if (index < 0) return
    const depth = rowsList[index].depth
    const viewport = getViewportRect(scrollBoxRef)
    if (!viewport) return
    scrollIntoView(
      scrollBoxRef,
      {
        x: viewport.x + ROW_LEFT_PADDING + depth * ROW_DEPTH_STEP - scrollBoxRef.scrollLeft,
        y: viewport.y + index - scrollBoxRef.scrollTop,
      },
      { trackX: true },
    )
  }

  createEffect(on(selectedId, ensureSelectedVisible, { defer: true }))

  const handleManualHorizontalScroll = (direction: "left" | "right") => {
    const delta = direction === "left" ? -HORIZONTAL_SCROLL_STEP : HORIZONTAL_SCROLL_STEP
    scrollBoxRef?.scrollBy({ x: delta, y: 0 })
  }

  const handleEmptySpaceClick = () => {
    explorer.focusSelf()
  }

  const bindings: KeyBinding[] = [
    { pattern: "down", handler: () => explorer.controller.moveSelection(1), preventDefault: true },
    { pattern: "j", handler: () => explorer.controller.moveSelection(1), preventDefault: true },
    { pattern: "up", handler: () => explorer.controller.moveSelection(-1), preventDefault: true },
    { pattern: "k", handler: () => explorer.controller.moveSelection(-1), preventDefault: true },
    { pattern: "right", handler: () => explorer.controller.focusFirstChild(), preventDefault: true },
    { pattern: "l", handler: () => explorer.controller.focusFirstChild(), preventDefault: true },
    { pattern: "left", handler: () => explorer.controller.collapseCurrentOrParent(), preventDefault: true },
    { pattern: "h", handler: () => explorer.controller.collapseCurrentOrParent(), preventDefault: true },
    {
      pattern: ["ctrl+h", "backspace"],
      handler: () => handleManualHorizontalScroll("left"),
      preventDefault: true,
    },
    { pattern: "ctrl+l", handler: () => handleManualHorizontalScroll("right"), preventDefault: true },
    { pattern: "enter", handler: () => explorer.controller.activateSelection(), preventDefault: true },
    { pattern: "space", handler: () => explorer.controller.activateSelection(), preventDefault: true },
  ]

  const enabled = () => explorer.isFocused()

  return (
    <KeyScope
      bindings={bindings}
      enabled={enabled}
    >
      <box
        flexDirection="column"
        height="100%"
        width="100%"
        flexGrow={1}
        flexShrink={1}
        paddingRight={1}
      >
        <box
          paddingLeft={1}
          paddingTop={1}
          flexDirection="column"
          flexGrow={1}
          height="100%"
          onMouseDown={handleEmptySpaceClick}
        >
          <Show when={explorer.error()}>
            {(message: Accessor<string | null>) => (
              <text fg={theme().get("error")}>Failed to load graph: {message()}</text>
            )}
          </Show>
          <OriScrollbox
            onReady={(node) => {
              scrollBoxRef = node
              ensureSelectedVisible()
            }}
            scrollSpeed={{ horizontal: 3, vertical: 1 }}
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
              <Show
                when={rootIds().length > 0}
                fallback={
                  <Show when={!explorer.loading() && !explorer.error()}>
                    <text
                      attributes={TextAttributes.DIM}
                      fg={theme().get("text_muted")}
                      selectable={false}
                    >
                      Graph is empty. Try refreshing later.
                    </text>
                  </Show>
                }
              >
                <For each={rootIds()}>
                  {(id) => (
                    <ExplorerRow
                      nodeId={id}
                      depth={0}
                      isFocused={explorer.isFocused}
                      explorer={explorer}
                      isRowSelected={isRowSelected}
                    />
                  )}
                </For>
              </Show>
            </box>
          </OriScrollbox>
        </box>
      </box>
    </KeyScope>
  )
}
