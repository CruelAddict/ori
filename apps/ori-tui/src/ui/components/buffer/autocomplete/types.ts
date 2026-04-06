import type { SelectPopupItem } from "@ui/components/select-popup"

export type BufferAutocompleteItem = SelectPopupItem & {
  insertText: string
}

export type BufferAutocompleteRequest = {
  text: string
  cursorOffset: number
}

export type BufferAutocompleteResult = {
  replaceStart: number
  replaceEnd: number
  items: BufferAutocompleteItem[]
}

export type BufferAutocompleteProvider = {
  getCompletions: (request: BufferAutocompleteRequest) => BufferAutocompleteResult | undefined
}

export type BufferAutocompleteState = BufferAutocompleteResult & {
  isOpen: boolean
  selectedIndex: number
}
