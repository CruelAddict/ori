import { buildLineStarts } from "@utils/line-offsets"
import { resolveSqlDialect } from "./sql-autocomplete/dialect"
import { getSqlAutocompleteResult } from "./sql-autocomplete/sql-engine"
import { buildSqlSchemaIndex } from "./sql-autocomplete/sql-schema-index"
import type { SqlEditorRequest, SqlEditorResponse, SqlEditorSchemaState } from "./sql-editor-protocol"
import { analyzeSqlDocument } from "./sql-statement-detector"

const EMPTY_SCHEMA: SqlEditorSchemaState = {
  nodesById: {},
  rootIds: [],
  loading: false,
  loaded: false,
}

const workerScope = globalThis as unknown as {
  postMessage: (message: SqlEditorResponse) => void
  onmessage: ((event: MessageEvent<SqlEditorRequest>) => void) | null
}

let schemaState: SqlEditorSchemaState = EMPTY_SCHEMA
let schemaIndex = buildSqlSchemaIndex(EMPTY_SCHEMA)
let dialect = resolveSqlDialect(EMPTY_SCHEMA.nodesById, EMPTY_SCHEMA.rootIds)
let lastAnalysis:
  | {
      text: string
      version: number
      result: ReturnType<typeof analyzeSqlDocument>
    }
  | undefined

function syncSchema(schema: SqlEditorSchemaState) {
  schemaState = schema
  schemaIndex = buildSqlSchemaIndex(schemaState)
  dialect = resolveSqlDialect(schemaState.nodesById, schemaState.rootIds)
}

function analyze(text: string, version: number) {
  if (lastAnalysis && lastAnalysis.version === version && lastAnalysis.text === text) {
    return {
      ...lastAnalysis.result,
      version,
    }
  }

  const result = analyzeSqlDocument(text, buildLineStarts(text))
  lastAnalysis = { text, version, result }
  return {
    ...result,
    version,
  }
}

function autocomplete(text: string, cursor: number) {
  return getSqlAutocompleteResult({
    text,
    cursorOffset: cursor,
    dialect,
    schema: schemaIndex,
  })
}

workerScope.onmessage = (event: MessageEvent<SqlEditorRequest>) => {
  const message = event.data
  if (message.type === "sync-schema") {
    syncSchema(message.schema)
    return
  }

  if (message.type === "analyze") {
    workerScope.postMessage({
      id: message.id,
      type: "analyze",
      result: analyze(message.text, message.version),
    })
    return
  }

  workerScope.postMessage({
    id: message.id,
    type: "autocomplete",
    result: autocomplete(message.text, message.cursor),
  })
}
