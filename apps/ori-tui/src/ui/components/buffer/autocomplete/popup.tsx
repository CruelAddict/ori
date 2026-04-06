import type { ScrollBoxRenderable } from "@opentui/core"
import { OriScrollbox } from "@ui/components/ori-scrollbox"
import { useTheme } from "@ui/providers/theme"
import { type KeyBinding, KeyScope } from "@ui/services/key-scopes"
import { type Accessor, createEffect, createMemo, For, Show } from "solid-js"
import type { BufferAutocompleteAnchor, BufferAutocompletePopupModel } from "./types"

type BufferAutocompletePopupProps = {
  popup: Accessor<BufferAutocompletePopupModel | undefined>
  onClose: () => void
  onMove: (delta: -1 | 1) => void
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

function getPopupWidth(popup: BufferAutocompletePopupModel, availableWidth: number, maxLimit: number) {
  const widths = popup.items.map((item) => Bun.stringWidth(item.label) + Bun.stringWidth(item.detail ?? "") + 6)
  const contentWidth = widths.length > 0 ? Math.max(...widths) : MIN_WIDTH
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, availableWidth, contentWidth, maxLimit))
}

export function BufferAutocompletePopup(props: BufferAutocompletePopupProps) {
  const { theme } = useTheme()
  let scrollRef: ScrollBoxRenderable | undefined
  const bindings: KeyBinding[] = [
    {
      pattern: "escape",
      preventDefault: true,
      handler: () => props.onClose(),
    },
    {
      pattern: "return",
      preventDefault: true,
      handler: () => props.onSelect(),
    },
    {
      pattern: "tab",
      preventDefault: true,
      handler: () => props.onSelect(),
    },
    {
      pattern: "up",
      preventDefault: true,
      handler: () => props.onMove(-1),
    },
    {
      pattern: "down",
      preventDefault: true,
      handler: () => props.onMove(1),
    },
  ]

  const rowCount = createMemo(() => {
    const count = props.popup()?.items.length ?? 0
    return Math.min(MAX_VISIBLE_ROWS, count)
  })

  const layout = createMemo(() => {
    const popup = props.popup()
    const anchor = popup?.anchor
    if (!popup || !anchor) {
      return null
    }

    const maxWidth = Math.max(MIN_WIDTH, anchor.containerWidth - 2)
    const maxHeight = Math.max(1, anchor.containerHeight - 2)
    const availableWidth = Math.max(MIN_WIDTH, anchor.containerWidth)
    const width = getPopupWidth(popup, availableWidth, maxWidth)
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
    const popup = props.popup()
    if (!popup || !scrollRef) {
      return
    }

    const viewportHeight = rowCount()
    const scrollTop = scrollRef.scrollTop
    const scrollBottom = scrollTop + viewportHeight
    if (popup.selectedIndex < scrollTop) {
      scrollRef.scrollBy(popup.selectedIndex - scrollTop)
      return
    }
    if (popup.selectedIndex + 1 > scrollBottom) {
      scrollRef.scrollBy(popup.selectedIndex + 1 - scrollBottom)
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
                    <For each={props.popup()?.items ?? []}>
                      {(item, index) => {
                        const selected = () => props.popup()?.selectedIndex === index()
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
    </KeyScope>
  )
}
