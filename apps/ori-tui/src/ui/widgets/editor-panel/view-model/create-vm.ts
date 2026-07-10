import { type DocCharOffset, docCharOffset } from "@ui/components/buffer/coords"
import type { QueryUsecase } from "@usecase/query/usecase"
import { getScriptFilePath, readScript, writeScript } from "@usecase/script/storage"
import { buildLineStarts } from "@utils/line-offsets"
import type { Accessor } from "solid-js"
import { createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { resolveSqlQueryAtOffset, type SqlAnalysisSnapshot } from "../sql-analysis"
import type { SqlEditorSchemaState } from "../sql-editor-protocol"
import { resolveSqlQueryAtOffset as resolveSqlQueryAtOffsetFallback } from "../sql-statement-detector"

type Query = Pick<
  QueryUsecase,
  "subscribe" | "getState" | "setQueryText"
>

export type EditorPaneViewModel = {
  queryText: Accessor<string>
  filePath: Accessor<string>
  getSchemaState: () => SqlEditorSchemaState
  subscribeSchemaState: (listener: () => void) => () => void
  onQueryChange: (text: string) => void
  executeQuery: (cursorOffset?: DocCharOffset, snapshot?: SqlAnalysisSnapshot) => Promise<void>
  saveQuery: () => boolean
  isFocused: Accessor<boolean>
  focusSelf: () => void
  unfocus: () => void
}

type CreateVMOptions = {
  query: Query
  executeQuery: (query: string) => string
  failQuery: (query: string, error: string) => string
  resourceName: Accessor<string>
  getSchemaState: () => SqlEditorSchemaState
  subscribeSchemaState: (listener: () => void) => () => void
  isFocused: Accessor<boolean>
  focusSelf: () => void
  unfocus: () => void
}

export function createVM(options: CreateVMOptions): EditorPaneViewModel {
  const [queryTextState, setQueryTextState] = createSignal(options.query.getState().queryText)

  const unsubscribe = options.query.subscribe(() => {
    setQueryTextState(options.query.getState().queryText)
  })

  onCleanup(() => {
    unsubscribe()
  })

  const queryText = createMemo(() => queryTextState())

  const onQueryChange = (text: string) => {
    options.query.setQueryText(text)
  }

  const executeQuery = async (cursorOffset?: DocCharOffset, snapshot?: SqlAnalysisSnapshot) => {
    const text = queryText()
    if (!text.trim()) {
      return
    }

    if (cursorOffset === undefined) {
      options.executeQuery(text)
      return
    }

    const lineStarts = buildLineStarts(text).map(docCharOffset)
    const resolution =
      snapshot === undefined
        ? resolveSqlQueryAtOffsetFallback(text, lineStarts, cursorOffset)
        : resolveSqlQueryAtOffset(snapshot, lineStarts, text, cursorOffset)
    if (resolution.kind === "ambiguous") {
      options.failQuery(text, "cannot execute query when multiple queries share the cursor line")
      return
    }
    if (resolution.kind === "none") {
      return
    }

    const query = text.slice(resolution.query.start, resolution.query.end)
    if (!query.trim()) {
      return
    }

    options.executeQuery(query)
  }

  const saveQuery = (): boolean => {
    const text = queryText()
    return writeScript(options.resourceName(), text)
  }

  onMount(() => {
    const name = options.resourceName()
    const existing = options.query.getState().queryText
    if (existing) {
      return
    }
    const saved = readScript(name)
    if (saved) {
      options.query.setQueryText(saved)
    }
  })

  const filePath = createMemo(() => getScriptFilePath(options.resourceName()))

  return {
    queryText,
    filePath,
    getSchemaState: options.getSchemaState,
    subscribeSchemaState: options.subscribeSchemaState,
    onQueryChange,
    executeQuery,
    saveQuery,
    isFocused: options.isFocused,
    focusSelf: options.focusSelf,
    unfocus: options.unfocus,
  }
}
