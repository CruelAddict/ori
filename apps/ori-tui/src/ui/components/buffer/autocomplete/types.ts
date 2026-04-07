import type { SelectPopupItem } from "@ui/components/select-popup"
import type { DocCharOffset, DocCharRange } from "../buffer-model/coords"

export type BufferAutocompleteItem = SelectPopupItem & {
  insertText: string
}

export type BufferAutocompleteRequest = {
  text: string
  cursor: DocCharOffset
}

export type BufferAutocompleteResult = {
  replace: DocCharRange
  items: BufferAutocompleteItem[]
}

export type BufferAutocompleteProvider = {
  getCompletions: (request: BufferAutocompleteRequest) => BufferAutocompleteResult | undefined
}

export type BufferAutocompleteState = BufferAutocompleteResult & {
  isOpen: boolean
  selectedIndex: number
}
