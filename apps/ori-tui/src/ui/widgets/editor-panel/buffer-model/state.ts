import type { TextareaRenderable } from "@opentui/core"
import { debounce } from "@utils/debounce"
import type { SyntaxHighlightResult } from "@utils/syntax-highlighter"
import { type Accessor, createSignal, type Setter } from "solid-js"
import { createStore, type SetStoreFunction } from "solid-js/store"
import { type Line, makeLinesFromText } from "./lines"

const DEBOUNCE_DEFAULT_MS = 20

export type BufferModelOptions = {
  initialText: string
  isFocused: Accessor<boolean>
  onTextChange: (text: string, info: { modified: boolean }) => void
  debounceMs?: number
  scheduleHighlight: (text: string, version: number | string) => void
  highlightResult: Accessor<SyntaxHighlightResult>
}

export type BufferDocument = {
  lines: Line[]
}

export type BufferSession = {
  contentModified: Accessor<boolean>
  setContentModified: Setter<boolean>
  focusedRow: Accessor<number>
  setFocusedRow: Setter<number>
  navColumn: Accessor<number>
  setNavColumn: Setter<number>
}

export type BufferResources = {
  lineRefs: Map<string, TextareaRenderable | undefined>
  highlightRequestVersion: number
  debouncedPush: ReturnType<typeof debounce>
}

export type BufferState = {
  document: BufferDocument
  setDocument: SetStoreFunction<BufferDocument>
  session: BufferSession
  resources: BufferResources
}

// BufferState holds the mutable source state for one editor instance.
// - document: canonical line content
// - session: reactive editing/navigation state
// - resources: imperative widget refs and async handles
export function createBufferState(options: BufferModelOptions): BufferState {
  const [document, setDocument] = createStore<BufferDocument>({
    lines: makeLinesFromText(options.initialText, true),
  })
  const [contentModified, setContentModified] = createSignal(false)
  const [focusedRow, setFocusedRow] = createSignal(0)
  const [navColumn, setNavColumn] = createSignal(0)
  const session: BufferSession = {
    contentModified,
    setContentModified,
    focusedRow,
    setFocusedRow,
    navColumn,
    setNavColumn,
  }
  const resources: BufferResources = {
    lineRefs: new Map<string, TextareaRenderable | undefined>(),
    highlightRequestVersion: 0,
    debouncedPush: debounce(() => {
      const text = document.lines.map((line) => line.text).join("\n")
      options.onTextChange(text, { modified: session.contentModified() })
    }, options.debounceMs ?? DEBOUNCE_DEFAULT_MS),
  }

  return {
    document,
    setDocument,
    session,
    resources,
  }
}
