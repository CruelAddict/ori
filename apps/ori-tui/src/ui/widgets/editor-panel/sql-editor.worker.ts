import { buildLineStarts } from "../../../utils/line-offsets"
import { resolveSqlDialect } from "./sql-autocomplete/dialect"
import { getSqlAutocompleteResult } from "./sql-autocomplete/sql-engine"
import { buildSqlSchemaIndex, type SqlSchemaInput } from "./sql-autocomplete/sql-schema-index"
import type { SqlEditorSchemaState, SqlEditorWorkerRequest, SqlEditorWorkerResponse } from "./sql-editor-worker-types"
import { analyzeSqlDocument } from "./sql-statement-detector"

const EMPTY_SCHEMA: SqlEditorSchemaState = {
  nodesById: {},
  rootIds: [],
  loading: false,
  loaded: false,
}

let schemaState: SqlEditorSchemaState = EMPTY_SCHEMA
let schemaIndex = buildSqlSchemaIndex(EMPTY_SCHEMA)
let dialect = resolveSqlDialect(EMPTY_SCHEMA.nodesById, EMPTY_SCHEMA.rootIds)
const workerScope = globalThis as unknown as {
  postMessage: (message: SqlEditorWorkerResponse) => void
  onmessage: ((event: MessageEvent<SqlEditorWorkerRequest>) => void) | null
}
let lastAnalysis:
  | {
      text: string
      version: number
      result: ReturnType<typeof analyzeSqlDocument>
    }
  | undefined

function syncSchema(schema: SqlSchemaInput) {
  schemaState = schema
  schemaIndex = buildSqlSchemaIndex(schemaState)
  dialect = resolveSqlDialect(schemaState.nodesById, schemaState.rootIds)
}

function getAnalysis(text: string, version: number) {
  if (lastAnalysis && lastAnalysis.version === version && lastAnalysis.text === text) {
    return lastAnalysis.result
  }

  const result = analyzeSqlDocument(text, buildLineStarts(text))
  lastAnalysis = { text, version, result }
  return result
}

function postMessageSafe(message: SqlEditorWorkerResponse) {
  workerScope.postMessage(message)
}

workerScope.onmessage = (event: MessageEvent<SqlEditorWorkerRequest>) => {
  const message = event.data
  if (message.type === "sync-schema") {
    syncSchema(message.schema)
    return
  }

  if (message.type === "analyze") {
    const result = getAnalysis(message.text, message.version)
    postMessageSafe({
      id: message.id,
      type: "analyze",
      result: {
        ...result,
        version: message.version,
      },
    })
    return
  }

  const result = getSqlAutocompleteResult({
    text: message.text,
    cursorOffset: message.cursor,
    dialect,
    schema: schemaIndex,
  })
  postMessageSafe({
    id: message.id,
    type: "autocomplete",
    result,
  })
}
