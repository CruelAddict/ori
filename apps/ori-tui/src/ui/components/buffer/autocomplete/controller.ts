import { type Accessor, createSignal } from "solid-js"
import { createSelectPopup, type SelectPopupModel } from "@ui/components/select-popup"
import type { BufferAutocompleteItem, BufferAutocompleteProvider } from "./types"

type CreateBufferAutocompleteOptions = {
  provider: Accessor<BufferAutocompleteProvider | undefined>
  isFocused: Accessor<boolean>
  getText: () => string
  getCursorOffset: () => number | undefined
  accept: (item: BufferAutocompleteItem, replaceStart: number, replaceEnd: number) => boolean
}

type BufferAutocompleteViewModel = SelectPopupModel<BufferAutocompleteItem> & {
  refresh: () => void
  replaceStart: Accessor<number | undefined>
}

export function createBufferAutocomplete(options: CreateBufferAutocompleteOptions) {
  const [replaceStart, setReplaceStart] = createSignal<number | undefined>()
  const [replaceEnd, setReplaceEnd] = createSignal<number | undefined>()
  const popup = createSelectPopup<BufferAutocompleteItem>({
    onSelect: (item) => {
      const start = replaceStart()
      const end = replaceEnd()
      if (start === undefined || end === undefined) {
        return false
      }

      return options.accept(item, start, end)
    },
    onClose: () => {
      setReplaceStart(undefined)
      setReplaceEnd(undefined)
    },
  })

  const refresh = () => {
    const provider = options.provider()
    const cursorOffset = options.getCursorOffset()
    if (!provider || !options.isFocused() || cursorOffset === undefined) {
      popup.close()
      return
    }

    const result = provider.getCompletions({
      text: options.getText(),
      cursorOffset,
    })
    if (!result || result.items.length === 0) {
      popup.close()
      return
    }

    setReplaceStart(result.replaceStart)
    setReplaceEnd(result.replaceEnd)
    popup.setItems(result.items)
  }

  return {
    ...popup,
    replaceStart,
    refresh,
  } satisfies BufferAutocompleteViewModel
}
