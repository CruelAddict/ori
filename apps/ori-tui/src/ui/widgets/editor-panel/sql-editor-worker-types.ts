import type { Node } from "@adapters/ori/client"
import type { BufferAutocompleteResult } from "@ui/components/buffer"
import type { SqlDocumentAnalysis } from "./sql-statement-detector"

export type SqlEditorSchemaState = {
  nodesById: Record<string, Node>
  rootIds: string[]
  loading: boolean
  loaded: boolean
}

export type SqlEditorWorkerRequest =
  | {
      type: "sync-schema"
      schema: SqlEditorSchemaState
    }
  | {
      id: number
      type: "analyze"
      text: string
      version: number
    }
  | {
      id: number
      type: "autocomplete"
      text: string
      cursor: number
    }

export type SqlEditorWorkerResponse =
  | {
      type: "ready"
    }
  | {
      id: number
      type: "analyze"
      result: SqlDocumentAnalysis & { version: number }
    }
  | {
      id: number
      type: "autocomplete"
      result: BufferAutocompleteResult | undefined
    }
