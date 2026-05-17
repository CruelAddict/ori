import { resolveSqlDialect } from "./sql-autocomplete/dialect"
import { getSqlAutocompleteResult } from "./sql-autocomplete/sql-engine"
import { buildSqlSchemaIndex } from "./sql-autocomplete/sql-schema-index"
import type { SqlEditorRequest, SqlEditorResponse, SqlEditorSchemaState } from "./sql-editor-protocol"

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

function syncSchema(schema: SqlEditorSchemaState) {
  schemaState = schema
  schemaIndex = buildSqlSchemaIndex(schemaState)
  dialect = resolveSqlDialect(schemaState.nodesById, schemaState.rootIds)
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

  workerScope.postMessage({
    id: message.id,
    type: "autocomplete",
    result: autocomplete(message.text, message.cursor),
  })
}
