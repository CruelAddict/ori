import { type Accessor, createSignal } from "solid-js"
import type { BufferAutocompleteItem, BufferAutocompleteProvider, BufferAutocompleteResult } from "./types"

type CreateBufferAutocompleteControllerOptions = {
  provider: Accessor<BufferAutocompleteProvider | undefined>
  isFocused: Accessor<boolean>
  getText: () => string
  getCursorOffset: () => number | undefined
  accept: (item: BufferAutocompleteItem, replaceStart: number, replaceEnd: number) => boolean
}

type BufferAutocompleteSession = BufferAutocompleteResult & { selectedIndex: number }

function getSelectedIndex(current: BufferAutocompleteSession | undefined, nextItems: BufferAutocompleteItem[]) {
  const selected = current?.items[current.selectedIndex]
  if (!selected) {
    return 0
  }

  const index = nextItems.findIndex((item) => item.id === selected.id)
  if (index >= 0) {
    return index
  }

  return Math.min(current.selectedIndex, Math.max(0, nextItems.length - 1))
}

export function createBufferAutocompleteController(options: CreateBufferAutocompleteControllerOptions) {
  const [popup, setPopup] = createSignal<BufferAutocompleteSession | undefined>()

  const close = () => {
    setPopup(undefined)
  }

  const refresh = () => {
    const provider = options.provider()
    const cursorOffset = options.getCursorOffset()
    if (!provider || !options.isFocused() || cursorOffset === undefined) {
      close()
      return
    }

    const result = provider.getCompletions({
      text: options.getText(),
      cursorOffset,
    })
    if (!result || result.items.length === 0) {
      close()
      return
    }

    const current = popup()
    setPopup({
      ...result,
      selectedIndex: getSelectedIndex(current, result.items),
    })
  }

  const move = (delta: -1 | 1) => {
    const current = popup()
    if (!current) {
      return
    }

    const size = current.items.length
    const selectedIndex = (current.selectedIndex + delta + size) % size
    setPopup({ ...current, selectedIndex })
  }

  const hover = (index: number) => {
    setPopup((current) => {
      if (!current) {
        return current
      }
      if (index < 0 || index >= current.items.length || current.selectedIndex === index) {
        return current
      }

      return { ...current, selectedIndex: index }
    })
  }

  const accept = () => {
    const current = popup()
    if (!current) {
      return false
    }

    const item = current.items[current.selectedIndex]
    if (!item) {
      return false
    }

    const applied = options.accept(item, current.replaceStart, current.replaceEnd)
    if (!applied) {
      return false
    }

    close()
    return true
  }

  return {
    popup,
    close,
    refresh,
    move,
    hover,
    accept,
  }
}
