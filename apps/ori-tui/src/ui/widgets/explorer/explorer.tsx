import type { InputRenderable, ScrollBoxRenderable } from "@opentui/core"
import { TextAttributes } from "@opentui/core"
import { getViewportRect, OriScrollbox, scrollIntoView } from "@ui/components/ori-scrollbox"
import { useTheme } from "@ui/providers/theme"
import { type KeyBinding, KeyScope } from "@ui/services/key-scopes"
import { type Accessor, createEffect, createMemo, createSelector, For, on, Show } from "solid-js"
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
  const treeRootIds = explorer.treeRootIds
  const rows = explorer.visibleRows
  const selectedId = explorer.selectedId
  const isRowSelected = createSelector(selectedId)
  const { theme } = useTheme()

  let scrollBoxRef: ScrollBoxRenderable | undefined
  let inputRef: InputRenderable | undefined

  const syncFilterFromInput = () => {
    queueMicrotask(() => {
      const value = inputRef?.value ?? ""
      if (value === explorer.filter()) return
      explorer.setFilter(value)
    })
  }

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

  const bindings = createMemo<KeyBinding[]>(() => {
    const bindings: KeyBinding[] = [
      { pattern: "down", handler: () => explorer.moveSelection(1), preventDefault: true },
      { pattern: "up", handler: () => explorer.moveSelection(-1), preventDefault: true },
      { pattern: "right", handler: () => explorer.focusFirstChild(), preventDefault: true },
      { pattern: "left", handler: () => explorer.collapseCurrentOrParent(), preventDefault: true },
      { pattern: "ctrl+l", handler: () => handleManualHorizontalScroll("right"), preventDefault: true },
      { pattern: "enter", handler: () => explorer.activateSelection(), preventDefault: true },
      {
        pattern: ["ctrl+w", "ctrl+backspace", "meta+backspace"],
        handler: () => syncFilterFromInput(),
      },
      {
        pattern: "escape",
        handler: () => {
          explorer.setMode("default")
          explorer.setFilter("")
        },
        preventDefault: true,
      },
    ]
    if (explorer.mode() === "default") {
      bindings.push(
        { pattern: "j", handler: () => explorer.moveSelection(1), preventDefault: true },
        { pattern: "k", handler: () => explorer.moveSelection(-1), preventDefault: true },
        { pattern: "l", handler: () => explorer.focusFirstChild(), preventDefault: true },
        { pattern: "h", handler: () => explorer.collapseCurrentOrParent(), preventDefault: true },
        {
          pattern: ["ctrl+h", "backspace"],
          handler: () => handleManualHorizontalScroll("left"),
          preventDefault: true,
        },
        { pattern: "space", handler: () => explorer.activateSelection(), preventDefault: true },
        {
          pattern: "s",
          handler: () => {
            explorer.setMode("search")
            queueMicrotask(() => {
              inputRef?.focus()
            })
          },
          preventDefault: true,
        },
      )
    }

    return bindings
  })

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
          <Show when={explorer.mode() === "search"}>
            <input
              ref={(el) => {
                inputRef = el
              }}
              value={explorer.filter()}
              placeholder={"Type to search"}
              cursorColor={theme().get("primary")}
              textColor={theme().get("text")}
              focusedTextColor={theme().get("text")}
              backgroundColor={theme().get("editor_background")}
              focusedBackgroundColor={theme().get("editor_background")}
              onInput={(value) => {
                explorer.setFilter(value)
              }}
              marginBottom={1}
            />
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
                when={treeRootIds().length > 0}
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
                <For each={treeRootIds()}>
                  {(nodeId) => (
                    <ExplorerRow
                      nodeId={nodeId}
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
