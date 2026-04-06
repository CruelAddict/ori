import { createSelectPopup, type SelectPopupAnchor, type SelectPopupViewModel } from "@ui/components/select-popup"
import { type Accessor, createMemo, createSignal } from "solid-js"
import type { BufferAutocompleteItem, BufferAutocompleteProvider } from "./types"

type CreateBufferAutocompleteOptions = {
  provider: Accessor<BufferAutocompleteProvider | undefined>
  isFocused: Accessor<boolean>
  getText: () => string
  getCursorOffset: () => number | undefined
  resolveAnchor: (replaceStart: number) => SelectPopupAnchor | null
  accept: (item: BufferAutocompleteItem, replaceStart: number, replaceEnd: number) => boolean
}

type BufferAutocompleteViewModel = {
  viewModel: Accessor<SelectPopupViewModel<BufferAutocompleteItem> | undefined>
  close: () => void
  refresh: () => void
}

export function createBufferAutocomplete(options: CreateBufferAutocompleteOptions) {
  const [replaceStart, setReplaceStart] = createSignal<number | undefined>()
  const [replaceEnd, setReplaceEnd] = createSignal<number | undefined>()
  let anchorTimer: ReturnType<typeof setTimeout> | undefined
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
      cancelAnchorResolve()
      setReplaceStart(undefined)
      setReplaceEnd(undefined)
    },
  })

  const cancelAnchorResolve = () => {
    if (anchorTimer === undefined) {
      return
    }

    clearTimeout(anchorTimer)
    anchorTimer = undefined
  }

  const scheduleAnchorResolve = (start: number) => {
    cancelAnchorResolve()
    anchorTimer = setTimeout(() => {
      anchorTimer = undefined
      if (replaceStart() !== start) {
        popup.setAnchor(null)
        return
      }

      popup.setAnchor(options.resolveAnchor(start))
    }, 0)
  }

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

    const prevStart = replaceStart()
    setReplaceStart(result.replaceStart)
    setReplaceEnd(result.replaceEnd)
    popup.setItems(result.items)
    if (prevStart === result.replaceStart && popup.anchor()) {
      return
    }

    popup.setAnchor(null)
    scheduleAnchorResolve(result.replaceStart)
  }

  const viewModel = createMemo<SelectPopupViewModel<BufferAutocompleteItem> | undefined>(() => {
    if (replaceStart() === undefined) {
      return
    }
    if (!popup.anchor()) {
      return undefined
    }

    return popup
  })

  return {
    viewModel,
    close: popup.close,
    refresh,
  } satisfies BufferAutocompleteViewModel
}
