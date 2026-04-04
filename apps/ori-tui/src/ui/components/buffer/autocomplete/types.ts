export type BufferAutocompleteItem = {
  id: string
  label: string
  insertText: string
  detail?: string
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

export type BufferAutocompleteAnchor = {
  x: number
  y: number
  containerWidth: number
  containerHeight: number
}
