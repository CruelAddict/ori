import type { MouseEvent, ScrollBoxRenderable } from "@opentui/core"
import { OriScrollbox } from "@ui/components/ori-scrollbox"
import type { SelectPopupAnchor, SelectPopupItem, SelectPopupViewModel } from "@ui/components/select-popup-model"
import { useTheme } from "@ui/providers/theme"
import { type KeyBinding, KeyScope } from "@ui/services/key-scopes"
import { type Accessor, createEffect, createMemo, createSignal, For, Show } from "solid-js"

type SelectPopupProps<T extends SelectPopupItem = SelectPopupItem> = {
  viewModel: Accessor<SelectPopupViewModel<T> | undefined>
}

const MAX_VISIBLE_ROWS = 8
const MIN_WIDTH = 24
const MAX_WIDTH = 64

function getPopupLeft(anchor: SelectPopupAnchor, width: number) {
  if (anchor.x + width <= anchor.containerWidth) {
    return anchor.x
  }

  return Math.max(0, anchor.containerWidth - width)
}

function getPopupWidth<T extends SelectPopupItem>(
  viewModel: SelectPopupViewModel<T>,
  availableWidth: number,
  maxLimit: number,
) {
  const widths = viewModel.items().map((item) => Bun.stringWidth(item.label) + Bun.stringWidth(item.detail ?? "") + 6)
  const contentWidth = widths.length > 0 ? Math.max(...widths) : MIN_WIDTH
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, availableWidth, contentWidth, maxLimit))
}

export function SelectPopup<T extends SelectPopupItem>(props: SelectPopupProps<T>) {
  const { theme } = useTheme()
  const [scrollRef, setScrollRef] = createSignal<ScrollBoxRenderable | undefined>()
  const bindings: KeyBinding[] = [
    {
      pattern: "escape",
      preventDefault: true,
      handler: () => props.viewModel()?.close(),
    },
    {
      pattern: "return",
      preventDefault: true,
      handler: () => props.viewModel()?.select(),
    },
    {
      pattern: "tab",
      preventDefault: true,
      handler: () => props.viewModel()?.select(),
    },
    {
      pattern: "up",
      preventDefault: true,
      handler: () => props.viewModel()?.move(-1),
    },
    {
      pattern: "ctrl+p",
      preventDefault: true,
      handler: () => props.viewModel()?.move(-1),
    },
    {
      pattern: "down",
      preventDefault: true,
      handler: () => props.viewModel()?.move(1),
    },
    {
      pattern: "ctrl+n",
      preventDefault: true,
      handler: () => props.viewModel()?.move(1),
    },
  ]

  const rowCount = createMemo(() => {
    const count = props.viewModel()?.items().length ?? 0
    return Math.min(MAX_VISIBLE_ROWS, count)
  })

  const layout = createMemo(() => {
    const viewModel = props.viewModel()
    const anchor = viewModel?.anchor()
    if (!viewModel || !anchor) {
      return null
    }

    const maxWidth = Math.max(MIN_WIDTH, anchor.containerWidth - 2)
    const maxHeight = Math.max(1, anchor.containerHeight - 2)
    const availableWidth = Math.max(MIN_WIDTH, anchor.containerWidth)
    const width = getPopupWidth(viewModel, availableWidth, maxWidth)
    const left = getPopupLeft(anchor, width)
    const height = Math.min(rowCount(), maxHeight)
    const popupHeight = height + 2
    const belowTop = anchor.y + 1
    const belowSpace = anchor.containerHeight - belowTop
    const top = belowSpace >= popupHeight ? belowTop : Math.max(0, anchor.y - popupHeight)

    return {
      left,
      top,
      width,
      height,
      popupHeight,
    }
  })

  createEffect(() => {
    if (layout()) {
      return
    }
    setScrollRef(undefined)
  })

  createEffect(() => {
    const viewModel = props.viewModel()
    const nextLayout = layout()
    const node = scrollRef()
    if (!viewModel || !nextLayout || !node) {
      return
    }

    const items = viewModel.items()
    const viewportHeight = nextLayout.height
    const maxScrollTop = Math.max(0, items.length - viewportHeight)
    if (node.scrollTop > maxScrollTop) {
      node.scrollTo({ x: node.scrollLeft, y: maxScrollTop })
    }

    const scrollTop = node.scrollTop
    const scrollBottom = scrollTop + viewportHeight
    const selectedIndex = viewModel.selectedIndex()
    if (selectedIndex < scrollTop) {
      node.scrollBy(selectedIndex - scrollTop)
      return
    }
    if (selectedIndex + 1 > scrollBottom) {
      node.scrollBy(selectedIndex + 1 - scrollBottom)
    }
  })

  return (
    <KeyScope
      bindings={bindings}
      enabled={() => Boolean(layout())}
    >
      <Show when={layout()}>
        {(nextLayout: Accessor<NonNullable<ReturnType<typeof layout>>>) => (
          <box
            position="absolute"
            top={nextLayout().top}
            left={nextLayout().left}
            width={nextLayout().width}
            height={nextLayout().popupHeight}
            zIndex={30}
            border
            borderColor={theme().get("border")}
            backgroundColor={theme().get("editor_background")}
          >
            <Show when={rowCount() > 0}>
              {() => (
                <OriScrollbox
                  onReady={(node) => {
                    setScrollRef(node)
                  }}
                  height={nextLayout().height}
                  scrollbarOptions={{ visible: false }}
                >
                  <box flexDirection="column">
                    <For each={props.viewModel()?.items() ?? []}>
                      {(item, index) => {
                        const selected = () => props.viewModel()?.selectedIndex() === index()
                        return (
                          <box
                            flexDirection="row"
                            paddingLeft={1}
                            paddingRight={1}
                            backgroundColor={selected() ? theme().get("primary") : theme().get("editor_background")}
                            onMouseMove={() => props.viewModel()?.hover(index())}
                            onMouseDown={(event: MouseEvent) => {
                              event.preventDefault()
                              event.stopPropagation()
                              props.viewModel()?.hover(index())
                            }}
                            onMouseUp={(event: MouseEvent) => {
                              event.stopPropagation()
                              props.viewModel()?.select()
                            }}
                          >
                            <box flexGrow={1}>
                              <text fg={selected() ? theme().get("editor_background") : theme().get("text")}>
                                {item.label}
                              </text>
                            </box>
                            <Show when={item.detail}>
                              <box paddingLeft={2}>
                                <text fg={selected() ? theme().get("editor_background") : theme().get("text_muted")}>
                                  {item.detail}
                                </text>
                              </box>
                            </Show>
                          </box>
                        )
                      }}
                    </For>
                  </box>
                </OriScrollbox>
              )}
            </Show>
          </box>
        )}
      </Show>
    </KeyScope>
  )
}
