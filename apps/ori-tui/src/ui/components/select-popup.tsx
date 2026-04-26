import type { MouseEvent, ScrollBoxRenderable } from "@opentui/core"
import { OriScrollbox } from "@ui/components/ori-scrollbox"
import type { SelectPopupItem, SelectPopupViewModel } from "@ui/components/select-popup-model"
import { useTheme } from "@ui/providers/theme"
import { type KeyBinding, KeyScope } from "@ui/services/key-scopes"
import { type Accessor, createEffect, createMemo, createSignal, For, Show } from "solid-js"

type SelectPopupProps<T extends SelectPopupItem = SelectPopupItem> = {
  viewModel: Accessor<SelectPopupViewModel<T> | undefined>
}

type SelectPopupLayout = {
  left: number
  top: number
  width: number
  height: number
  popupHeight: number
}

const MAX_VISIBLE_ROWS = 8
const MIN_WIDTH = 24
const MAX_WIDTH = 64
const DETAIL_GAP = 2
const ELLIPSIS = "…"
const LABEL_SHARE = 0.7
const ROW_PADDING = 2

function truncateMiddleByWidth(value: string, limit: number) {
  if (limit <= 0) {
    return ""
  }
  if (Bun.stringWidth(value) <= limit) {
    return value
  }
  if (limit === 1) {
    return ELLIPSIS
  }

  const chars = Array.from(value)
  const tail: string[] = []
  let left = ""
  let leftWidth = 0
  let rightWidth = 0
  let start = 0
  let end = chars.length - 1
  const budget = limit - Bun.stringWidth(ELLIPSIS)

  while (start <= end) {
    const pickLeft = leftWidth <= rightWidth
    const index = pickLeft ? start : end
    const ch = chars[index] ?? ""
    const width = Bun.stringWidth(ch)
    if (leftWidth + rightWidth + width > budget) {
      break
    }

    if (pickLeft) {
      left += ch
      leftWidth += width
      start += 1
      continue
    }

    tail.unshift(ch)
    rightWidth += width
    end -= 1
  }

  return `${left}${ELLIPSIS}${tail.join("")}`
}

function formatSelectPopupItem(item: SelectPopupItem, rowWidth: number) {
  const availableWidth = Math.max(1, rowWidth - ROW_PADDING)
  if (!item.detail) {
    return {
      label: truncateMiddleByWidth(item.label, availableWidth),
    }
  }

  const contentWidth = availableWidth - DETAIL_GAP
  if (contentWidth < 6) {
    return {
      label: truncateMiddleByWidth(item.label, availableWidth),
    }
  }

  const detailWidth = Math.min(Bun.stringWidth(item.detail), Math.max(1, Math.floor(contentWidth * (1 - LABEL_SHARE))))
  const labelWidth = Math.max(1, contentWidth - detailWidth)
  return {
    label: truncateMiddleByWidth(item.label, labelWidth),
    detail: truncateMiddleByWidth(item.detail, detailWidth),
  }
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

function getPopupLayout(
  anchor: { x: number; y: number; containerWidth: number; containerHeight: number },
  width: number,
  rowCount: number,
): SelectPopupLayout | null {
  const left = anchor.x + width <= anchor.containerWidth ? anchor.x : Math.max(0, anchor.containerWidth - width)
  const rows = Math.max(0, rowCount)
  const belowTop = anchor.y + 1
  const belowRows = Math.max(0, anchor.containerHeight - belowTop - 2)
  const aboveRows = Math.max(0, anchor.y - 2)
  const belowHeight = Math.min(rows, belowRows)
  const aboveHeight = Math.min(rows, aboveRows)
  if (belowHeight <= 0 && aboveHeight <= 0) {
    return null
  }

  if (belowHeight >= aboveHeight) {
    return {
      left,
      top: belowTop,
      width,
      height: belowHeight,
      popupHeight: belowHeight + 2,
    }
  }

  return {
    left,
    top: anchor.y - aboveHeight - 2,
    width,
    height: aboveHeight,
    popupHeight: aboveHeight + 2,
  }
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
    const availableWidth = Math.max(MIN_WIDTH, anchor.containerWidth)
    const width = getPopupWidth(viewModel, availableWidth, maxWidth)
    return getPopupLayout(anchor, width, rowCount())
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
                        const content = () => formatSelectPopupItem(item, Math.max(1, nextLayout().width - 2))
                        return (
                          <box
                            flexDirection="row"
                            paddingLeft={1}
                            paddingRight={1}
                            minWidth={0}
                            overflow="hidden"
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
                            <box
                              flexGrow={1}
                              flexShrink={1}
                              minWidth={0}
                              overflow="hidden"
                            >
                              <text fg={selected() ? theme().get("editor_background") : theme().get("text")}>
                                {content().label}
                              </text>
                            </box>
                            <Show when={content().detail}>
                              <box
                                paddingLeft={2}
                                flexShrink={1}
                                minWidth={0}
                                overflow="hidden"
                              >
                                <text fg={selected() ? theme().get("editor_background") : theme().get("text_muted")}>
                                  {content().detail}
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
