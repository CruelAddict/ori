import type { Node } from "@adapters/ori/client"
import type { BufferAutocompleteResult } from "@ui/components/buffer"

export type SqlEditorSchemaState = {
  nodesById: Record<string, Node>
  rootIds: string[]
  loading: boolean
  loaded: boolean
}

export type SqlEditorRequest =
  | {
      type: "sync-schema"
      schema: SqlEditorSchemaState
    }
  | {
      id: number
      type: "autocomplete"
      text: string
      cursor: number
    }

export type SqlEditorResponse = {
  id: number
  type: "autocomplete"
  result: BufferAutocompleteResult | undefined
}
