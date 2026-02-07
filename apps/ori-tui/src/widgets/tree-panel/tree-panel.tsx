import { useTheme } from "@app/providers/theme"
import { TextAttributes } from "@opentui/core"
import { type KeyBinding, KeyScope } from "@src/core/services/key-scopes"
import type { TreePaneViewModel } from "@src/features/tree-pane/use-tree-pane"
import { type Accessor, createSelector, For, Show } from "solid-js"
import { TreePaneRow } from "./tree-pane-row.tsx"
import { TreeScrollbox, type TreeScrollboxApi } from "./tree-scrollbox.tsx"

const HORIZONTAL_SCROLL_STEP = 6

export type TreePanelProps = {
  viewModel: TreePaneViewModel
}

export function TreePanel(props: TreePanelProps) {
  const pane = props.viewModel
  const rootIds = pane.controller.rootIds
  const rows = pane.controller.visibleRows
  const selectedId = pane.controller.selectedId
  const isRowSelected = createSelector(selectedId)
  const { theme } = useTheme()

  let treeScrollboxApi: TreeScrollboxApi | null = null
  const handleScrollboxApi = (api?: TreeScrollboxApi) => {
    treeScrollboxApi = api ?? null
  }

  const handleManualHorizontalScroll = (direction: "left" | "right") => {
    const delta = direction === "left" ? -HORIZONTAL_SCROLL_STEP : HORIZONTAL_SCROLL_STEP
    treeScrollboxApi?.scrollBy({ x: delta, y: 0 })
  }

  const handleEmptySpaceClick = () => {
    pane.focusSelf()
    treeScrollboxApi?.ensureRowVisible(selectedId())
  }

  const bindings: KeyBinding[] = [
    { pattern: "down", handler: () => pane.controller.moveSelection(1), preventDefault: true },
    { pattern: "j", handler: () => pane.controller.moveSelection(1), preventDefault: true },
    { pattern: "up", handler: () => pane.controller.moveSelection(-1), preventDefault: true },
    { pattern: "k", handler: () => pane.controller.moveSelection(-1), preventDefault: true },
    { pattern: "right", handler: () => pane.controller.focusFirstChild(), preventDefault: true },
    { pattern: "l", handler: () => pane.controller.focusFirstChild(), preventDefault: true },
    { pattern: "left", handler: () => pane.controller.collapseCurrentOrParent(), preventDefault: true },
    { pattern: "h", handler: () => pane.controller.collapseCurrentOrParent(), preventDefault: true },
    { pattern: ["ctrl+h", "backspace"], handler: () => handleManualHorizontalScroll("left"), preventDefault: true },
    { pattern: "ctrl+l", handler: () => handleManualHorizontalScroll("right"), preventDefault: true },
    { pattern: "enter", handler: () => pane.controller.activateSelection(), preventDefault: true },
    { pattern: "space", handler: () => pane.controller.activateSelection(), preventDefault: true },
  ]

  const enabled = () => pane.isFocused()

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
      >
        <box
          paddingLeft={1}
          paddingTop={1}
          flexDirection="column"
          flexGrow={1}
          height="100%"
          onMouseDown={handleEmptySpaceClick}
        >
          <Show when={pane.loading()}>
            <text fg={theme().text}>Loading schema graph...</text>
          </Show>
          <Show when={pane.error()}>
            {(message: Accessor<string | null>) => <text fg={theme().error}>Failed to load graph: {message()}</text>}
          </Show>
          <TreeScrollbox
            rows={rows}
            selectedRowId={selectedId}
            onApiReady={handleScrollboxApi}
          >
            <Show
              when={rootIds().length > 0}
              fallback={
                <Show when={!pane.loading() && !pane.error()}>
                  <text
                    attributes={TextAttributes.DIM}
                    fg={theme().textMuted}
                    selectable={false}
                  >
                    Graph is empty. Try refreshing later.
                  </text>
                </Show>
              }
            >
              <For each={rootIds()}>
                {(id) => (
                  <TreePaneRow
                    nodeId={id}
                    depth={0}
                    isFocused={pane.isFocused}
                    pane={pane}
                    isRowSelected={isRowSelected}
                  />
                )}
              </For>
            </Show>
          </TreeScrollbox>
        </box>
      </box>
    </KeyScope>
  )
}
