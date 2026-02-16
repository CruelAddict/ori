import { useTheme } from "@app/providers/theme"
import { TextAttributes } from "@opentui/core"
import { type KeyBinding, KeyScope } from "@src/core/services/key-scopes"
import { type Accessor, createSelector, For, Show } from "solid-js"
import { ExplorerRow } from "./explorer-row.tsx"
import { ExplorerScrollbox, type ExplorerScrollboxApi } from "./explorer-scrollbox.tsx"
import type { ExplorerViewModel } from "./model/create-explorer-model"

const HORIZONTAL_SCROLL_STEP = 6

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

  let explorerScrollboxApi: ExplorerScrollboxApi | null = null
  const handleScrollboxApi = (api?: ExplorerScrollboxApi) => {
    explorerScrollboxApi = api ?? null
  }

  const handleManualHorizontalScroll = (direction: "left" | "right") => {
    const delta = direction === "left" ? -HORIZONTAL_SCROLL_STEP : HORIZONTAL_SCROLL_STEP
    explorerScrollboxApi?.scrollBy({ x: delta, y: 0 })
  }

  const handleEmptySpaceClick = () => {
    explorer.focusSelf()
    explorerScrollboxApi?.ensureRowVisible(selectedId())
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
        maxWidth={"44%"}
        flexGrow={0}
        flexShrink={0}
        border={["right"]}
        borderColor={theme().get("border")}
        paddingRight={1}
        marginBottom={1}
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
          <ExplorerScrollbox
            rows={rows}
            selectedRowId={selectedId}
            onApiReady={handleScrollboxApi}
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
          </ExplorerScrollbox>
        </box>
      </box>
    </KeyScope>
  )
}
