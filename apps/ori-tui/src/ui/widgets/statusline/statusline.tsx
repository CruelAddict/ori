import { useAppState } from "@ui/providers/app-state"
import { useTheme } from "@ui/providers/theme"
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { buildStatuslineModel, type StatuslineColor, type StatuslineItem } from "./statusline-model"

const CLOCK_TICK_MS = 250

function itemsWithDelimiter(items: StatuslineItem[], delimiter: string, color: (value: StatuslineColor) => string) {
  return (
    <For each={items}>
      {(item, index) => (
        <>
          <Show when={index() > 0}>
            <text selectable={false}>{delimiter}</text>
          </Show>
          <For each={item.segments}>
            {(segment) => (
              <text
                fg={color(segment.color)}
                selectable={false}
              >
                {segment.text}
              </text>
            )}
          </For>
        </>
      )}
    </For>
  )
}

export function Statusline() {
  const appState = useAppState()
  const { theme } = useTheme()
  const now = createClock()
  const snapshot = createMemo(() => {
    const resource = appState.activeResourceView()
    if (!resource) {
      return {}
    }
    return {
      resource: {
        name: resource.resourceName(),
        queryJob: resource.editor.currentJob(),
      },
    }
  })
  const model = createMemo(() => buildStatuslineModel(snapshot(), now()))
  const right = createMemo(() => [...model().right].reverse())
  const color = (value: StatuslineColor) => theme().get(value)

  return (
    <box
      flexDirection="row"
      justifyContent="space-between"
      minHeight={1}
      maxHeight={1}
      marginBottom={1}
      paddingLeft={3}
      paddingRight={3}
    >
      <box flexDirection="row">{itemsWithDelimiter(model().left, "  ", color)}</box>
      <box flexDirection="row">{itemsWithDelimiter(right(), "  ", color)}</box>
    </box>
  )
}

function createClock() {
  const [now, setNow] = createSignal(Date.now())
  const id = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS)
  onCleanup(() => clearInterval(id))
  return now
}
