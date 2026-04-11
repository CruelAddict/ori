import type { ScrollBoxRenderable } from "@opentui/core"
import { OriScrollbox } from "@ui/components/ori-scrollbox"
import { useTheme } from "@ui/providers/theme"
import { type KeyBinding, KeyScope } from "@ui/services/key-scopes"
import { type Accessor, createEffect, createMemo, createSignal, For, Show } from "solid-js"

export type SelectPopupAnchor = {
  x: number
  y: number
  containerWidth: number
  containerHeight: number
}

export type SelectPopupItem = {
  id: string
  label: string
  detail?: string
}

export type SelectPopupViewModel<T extends SelectPopupItem = SelectPopupItem> = {
  anchor: Accessor<SelectPopupAnchor | null>
  items: Accessor<readonly T[]>
  selectedIndex: Accessor<number>
  close: () => void
  move: (delta: -1 | 1) => void
  hover: (index: number) => void
  select: () => boolean
}

export type SelectPopupModel<T extends SelectPopupItem = SelectPopupItem> = SelectPopupViewModel<T> & {
  setAnchor: (anchor: SelectPopupAnchor | null) => void
  setItems: (items: readonly T[]) => void
}

type CreateSelectPopupOptions<T extends SelectPopupItem> = {
  onSelect: (item: T) => boolean
  onClose?: () => void
}

type SelectPopupProps<T extends SelectPopupItem = SelectPopupItem> = {
  viewModel: Accessor<SelectPopupViewModel<T> | undefined>
}

const MAX_VISIBLE_ROWS = 8
const MIN_WIDTH = 24
const MAX_WIDTH = 64

function getSelectedIndex<T extends SelectPopupItem>(current: readonly T[], currentIndex: number, next: readonly T[]) {
  const selected = current[currentIndex]
  if (!selected) {
    return 0
  }

  const index = next.findIndex((item) => item.id === selected.id)
  if (index >= 0) {
    return index
  }

  return Math.min(currentIndex, Math.max(0, next.length - 1))
}

function getPopupLeft(anchor: SelectPopupAnchor, width: number) {
  if (anchor.x + width <= anchor.containerWidth) {
    return anchor.x
  }

  return Math.max(0, anchor.containerWidth - width)
}

function getPopupWidth<T extends SelectPopupItem>(viewModel: SelectPopupViewModel<T>, availableWidth: number, maxLimit: number) {
  const widths = viewModel.items().map((item) => Bun.stringWidth(item.label) + Bun.stringWidth(item.detail ?? "") + 6)
  const contentWidth = widths.length > 0 ? Math.max(...widths) : MIN_WIDTH
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, availableWidth, contentWidth, maxLimit))
}

export function createSelectPopup<T extends SelectPopupItem>(options: CreateSelectPopupOptions<T>): SelectPopupModel<T> {
  const [anchor, setAnchor] = createSignal<SelectPopupAnchor | null>(null)
  const [items, setItemsValue] = createSignal<readonly T[]>([])
  const [selectedIndex, setSelectedIndex] = createSignal(0)

  const close = () => {
    setAnchor(null)
    setItemsValue([])
    setSelectedIndex(0)
    options.onClose?.()
  }

  const setItems = (next: readonly T[]) => {
    setSelectedIndex((currentIndex) => getSelectedIndex(items(), currentIndex, next))
    setItemsValue(next)
  }

  const move = (delta: -1 | 1) => {
    const size = items().length
    if (size === 0) {
      return
    }

    setSelectedIndex((currentIndex) => (currentIndex + delta + size) % size)
  }

  const hover = (index: number) => {
    const size = items().length
    if (index < 0 || index >= size || selectedIndex() === index) {
      return
    }

    setSelectedIndex(index)
  }

  const select = () => {
    const item = items()[selectedIndex()]
    if (!item) {
      return false
    }

    const applied = options.onSelect(item)
    if (!applied) {
      return false
    }

    close()
    return true
  }

  return {
    anchor,
    items,
    selectedIndex,
    setAnchor,
    setItems,
    close,
    move,
    hover,
    select,
  }
}

export function SelectPopup<T extends SelectPopupItem>(props: SelectPopupProps<T>) {
  const { theme } = useTheme()
  let scrollRef: ScrollBoxRenderable | undefined
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
      pattern: "down",
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
    const belowTop = anchor.y + 1
    const belowSpace = anchor.containerHeight - belowTop
    const top = belowSpace >= height ? belowTop : Math.max(0, anchor.y - height)

    return {
      left,
      top,
      width,
      height,
    }
  })

  createEffect(() => {
    const viewModel = props.viewModel()
    if (!viewModel || !scrollRef) {
      return
    }

    const viewportHeight = rowCount()
    const scrollTop = scrollRef.scrollTop
    const scrollBottom = scrollTop + viewportHeight
    const selectedIndex = viewModel.selectedIndex()
    if (selectedIndex < scrollTop) {
      scrollRef.scrollBy(selectedIndex - scrollTop)
      return
    }
    if (selectedIndex + 1 > scrollBottom) {
      scrollRef.scrollBy(selectedIndex + 1 - scrollBottom)
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
            height={nextLayout().height + 2}
            zIndex={30}
            border
            borderColor={theme().get("border")}
            backgroundColor={theme().get("editor_background")}
          >
            <Show when={rowCount() > 0}>
              {() => (
                <OriScrollbox
                  onReady={(node) => {
                    scrollRef = node
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
                            onMouseOver={() => props.viewModel()?.hover(index())}
                            onMouseDown={() => {
                              props.viewModel()?.hover(index())
                            }}
                            onMouseUp={() => props.viewModel()?.select()}
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
