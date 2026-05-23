import type { SelectPopupItem } from "@ui/components/select-popup-model"
import type { DocCharOffset, DocCharRange } from "../coords"

export type BufferAutocompleteItem = SelectPopupItem & {
  insertText: string
  cursorOffset?: number
}

export type BufferAutocompleteRequest = {
  text: string
  cursor: DocCharOffset
  signal: AbortSignal
}

export type BufferAutocompleteResult = {
  replace: DocCharRange
  items: BufferAutocompleteItem[]
}

export type BufferAutocompleteProvider = {
  getCompletions: (request: BufferAutocompleteRequest) => Promise<BufferAutocompleteResult | undefined>
  subscribeState?: (listener: () => void) => () => void
}

export type BufferAutocompleteState = BufferAutocompleteResult & {
  isOpen: boolean
  selectedIndex: number
}
