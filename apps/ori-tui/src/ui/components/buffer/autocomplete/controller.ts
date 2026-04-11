import { createSelectPopup, type SelectPopupAnchor, type SelectPopupViewModel } from "@ui/components/select-popup"
import { type Accessor, createMemo, createSignal } from "solid-js"
import type { DocCharOffset, DocCharRange } from "../buffer-model/coords"
import type { BufferAutocompleteItem, BufferAutocompleteProvider } from "./types"

function isAutoAutocompleteAllowed(text: string, cursor: number) {
  const next = text[cursor]
  if (next === undefined) {
    return true
  }

  return next === " " || next === "\t" || next === "\n" || next === "\r"
}

type CreateBufferAutocompleteOptions = {
  provider: Accessor<BufferAutocompleteProvider | undefined>
  isFocused: Accessor<boolean>
  getText: () => string
  getCursorOffset: () => DocCharOffset | undefined
  resolveAnchor: (replaceStart: DocCharOffset) => SelectPopupAnchor | null
  accept: (item: BufferAutocompleteItem, range: DocCharRange) => boolean
}

type BufferAutocompleteViewModel = {
  viewModel: Accessor<SelectPopupViewModel<BufferAutocompleteItem> | undefined>
  close: () => void
  refresh: () => void
}

export function createBufferAutocomplete(options: CreateBufferAutocompleteOptions) {
  const [replace, setReplace] = createSignal<DocCharRange | undefined>()
  let anchorTimer: ReturnType<typeof setTimeout> | undefined
  const popup = createSelectPopup<BufferAutocompleteItem>({
    onSelect: (item) => {
      const range = replace()
      if (!range) {
        return false
      }

      return options.accept(item, range)
    },
    onClose: () => {
      cancelAnchorResolve()
      setReplace(undefined)
    },
  })

  const cancelAnchorResolve = () => {
    if (anchorTimer === undefined) {
      return
    }

    clearTimeout(anchorTimer)
    anchorTimer = undefined
  }

  const scheduleAnchorResolve = (start: DocCharOffset) => {
    cancelAnchorResolve()
    anchorTimer = setTimeout(() => {
      anchorTimer = undefined
      if (replace()?.start !== start) {
        popup.setAnchor(null)
        return
      }

      popup.setAnchor(options.resolveAnchor(start))
    }, 0)
  }

  const refresh = () => {
    const provider = options.provider()
    const cursor = options.getCursorOffset()
    if (!provider || !options.isFocused() || cursor === undefined) {
      popup.close()
      return
    }

    const text = options.getText()
    if (!isAutoAutocompleteAllowed(text, cursor)) {
      popup.close()
      return
    }

    const result = provider.getCompletions({
      text,
      cursor,
    })
    if (!result || result.items.length === 0) {
      popup.close()
      return
    }

    const prevStart = replace()?.start
    setReplace(result.replace)
    popup.setItems(result.items)
    if (prevStart === result.replace.start && popup.anchor()) {
      return
    }

    popup.setAnchor(null)
    scheduleAnchorResolve(result.replace.start)
  }

  const viewModel = createMemo<SelectPopupViewModel<BufferAutocompleteItem> | undefined>(() => {
    if (!replace()) {
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
