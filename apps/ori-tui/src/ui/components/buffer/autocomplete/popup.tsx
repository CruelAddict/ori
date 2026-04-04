import type { ScrollBoxRenderable } from "@opentui/core"
import { OriScrollbox } from "@ui/components/ori-scrollbox"
import { useTheme } from "@ui/providers/theme"
import { type Accessor, createEffect, createMemo, For, Show } from "solid-js"
import type { BufferAutocompleteAnchor, BufferAutocompleteState } from "./types"

type BufferAutocompletePopupProps = {
  state: Accessor<BufferAutocompleteState | undefined>
  anchor: Accessor<BufferAutocompleteAnchor | null>
  maxWidth: Accessor<number>
  maxHeight: Accessor<number>
  onHover: (index: number) => void
  onSelect: () => void
}

const MAX_VISIBLE_ROWS = 8
const MIN_WIDTH = 24
const MAX_WIDTH = 64

function getPopupLeft(anchor: BufferAutocompleteAnchor, width: number) {
  if (anchor.x + width <= anchor.containerWidth) {
    return anchor.x
  }

  return Math.max(0, anchor.x + 1 - width)
}

function getPopupWidth(state: BufferAutocompleteState, availableWidth: number, maxLimit: number) {
  const widths = state.items.map((item) => Bun.stringWidth(item.label) + Bun.stringWidth(item.detail ?? "") + 6)
  const contentWidth = widths.length > 0 ? Math.max(...widths) : MIN_WIDTH
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, availableWidth, contentWidth, maxLimit))
}

export function BufferAutocompletePopup(props: BufferAutocompletePopupProps) {
  const { theme } = useTheme()
  let scrollRef: ScrollBoxRenderable | undefined

  const rowCount = createMemo(() => {
    const count = props.state()?.items.length ?? 0
    return Math.min(MAX_VISIBLE_ROWS, count)
  })

  const popupKey = createMemo(() => {
    const state = props.state()
    return `${state?.replaceStart ?? -1}:${state?.replaceEnd ?? -1}:${rowCount()}`
  })

  const layout = createMemo(() => {
    const anchor = props.anchor()
    const state = props.state()
    if (!anchor || !state?.isOpen) {
      return null
    }

    const maxWidth = Math.max(MIN_WIDTH, props.maxWidth())
    const maxHeight = Math.max(1, props.maxHeight())
    const availableWidth = Math.max(MIN_WIDTH, anchor.containerWidth)
    const width = getPopupWidth(state, availableWidth, maxWidth)
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
    const state = props.state()
    if (!state || !scrollRef) {
      return
    }

    const viewportHeight = rowCount()
    const scrollTop = scrollRef.scrollTop
    const scrollBottom = scrollTop + viewportHeight
    if (state.selectedIndex < scrollTop) {
      scrollRef.scrollBy(state.selectedIndex - scrollTop)
      return
    }
    if (state.selectedIndex + 1 > scrollBottom) {
      scrollRef.scrollBy(state.selectedIndex + 1 - scrollBottom)
    }
  })

  return (
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
          <Show
            when={popupKey() && rowCount() > 0}
            keyed
          >
            {() => (
              <OriScrollbox
                onReady={(node) => {
                  scrollRef = node
                }}
                height={nextLayout().height}
                scrollbarOptions={{ visible: false }}
              >
                <box flexDirection="column">
                  <For each={props.state()?.items ?? []}>
                    {(item, index) => {
                      const selected = () => props.state()?.selectedIndex === index()
                      return (
                        <box
                          flexDirection="row"
                          paddingLeft={1}
                          paddingRight={1}
                          backgroundColor={selected() ? theme().get("primary") : theme().get("editor_background")}
                          onMouseOver={() => props.onHover(index())}
                          onMouseDown={() => {
                            props.onHover(index())
                          }}
                          onMouseUp={props.onSelect}
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
  )
}
