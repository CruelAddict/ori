import { createSelectPopup, type SelectPopupAnchor, type SelectPopupViewModel } from "@ui/components/select-popup-model"
import { type Accessor, createMemo, createSignal } from "solid-js"
import type { DocCharOffset, DocCharRange } from "../buffer-model/coords"
import type { BufferAutocompleteItem, BufferAutocompleteProvider } from "./types"

const AUTOCOMPLETE_COALESCE_MS = 8

function isAutoAutocompleteAllowed(text: string, cursor: number) {
  const next = text[cursor]
  if (next === undefined) {
    return true
  }

  return next === " " || next === "\t" || next === "\n" || next === "\r" || next === ")" || next === "," || next === ";"
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
  syncAnchor: () => void
}

export function createBufferAutocomplete(options: CreateBufferAutocompleteOptions) {
  const [replace, setReplace] = createSignal<DocCharRange | undefined>()
  let anchorTimer: ReturnType<typeof setTimeout> | undefined
  let refreshTimer: ReturnType<typeof setTimeout> | undefined
  let refreshToken = 0
  let refreshAbort: AbortController | undefined
  const popup = createSelectPopup<BufferAutocompleteItem>({
    onSelect: (item) => {
      const range = replace()
      if (!range) {
        return false
      }

      return options.accept(item, range)
    },
    onClose: () => {
      cancelRefresh()
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

  const cancelRefresh = () => {
    if (refreshTimer !== undefined) {
      clearTimeout(refreshTimer)
      refreshTimer = undefined
    }
    refreshAbort?.abort()
    refreshAbort = undefined
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

  const applyResult = (result: Awaited<ReturnType<BufferAutocompleteProvider["getCompletions"]>>) => {
    if (!result || result.items.length === 0) {
      popup.close()
      return
    }

    const prevStart = replace()?.start
    setReplace(result.replace)
    popup.setItems(result.items, { selectedIndex: 0 })
    if (prevStart === result.replace.start && popup.anchor()) {
      return
    }

    popup.setAnchor(null)
    scheduleAnchorResolve(result.replace.start)
  }

  const runRefresh = async (
    token: number,
    provider: BufferAutocompleteProvider,
    text: string,
    cursor: DocCharOffset,
  ) => {
    const abort = new AbortController()
    refreshAbort = abort
    const result = await provider.getCompletions({
      text,
      cursor,
      signal: abort.signal,
    })
    if (abort.signal.aborted || token !== refreshToken) {
      return
    }

    applyResult(result)
  }

  const refresh = () => {
    if (!options.provider() || !options.isFocused()) {
      cancelRefresh()
      popup.close()
      return
    }

    cancelRefresh()
    refreshToken += 1
    const token = refreshToken
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined
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

      void runRefresh(token, provider, text, cursor).finally(() => {
        if (token !== refreshToken) {
          return
        }
        refreshAbort = undefined
      })
    }, AUTOCOMPLETE_COALESCE_MS)
  }

  const close = () => {
    cancelRefresh()
    popup.close()
  }

  const syncAnchor = () => {
    const range = replace()
    if (!range) {
      return
    }

    cancelAnchorResolve()
    const anchor = options.resolveAnchor(range.start)
    if (anchor) {
      popup.setAnchor(anchor)
      return
    }

    popup.close()
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
    close,
    refresh,
    syncAnchor,
  } satisfies BufferAutocompleteViewModel
}
