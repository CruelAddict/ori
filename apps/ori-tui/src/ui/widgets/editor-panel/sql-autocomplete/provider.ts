import type { BufferAutocompleteProvider } from "@ui/components/buffer"
import type { ResourceIntrospectionState } from "@usecase/introspection/usecase"
import { resolveSqlDialect } from "./dialect"
import { getSqlAutocompleteResult } from "./sql-engine"
import { buildSqlSchemaIndex } from "./sql-schema-index"

type SqlAutocompleteState = Pick<ResourceIntrospectionState, "nodesById" | "rootIds" | "loading" | "loaded">

type CreateSqlAutocompleteProviderOptions = {
  getState: () => SqlAutocompleteState
}

export function createSqlAutocompleteProvider(
  options: CreateSqlAutocompleteProviderOptions,
): BufferAutocompleteProvider {
  let cachedNodesById: SqlAutocompleteState["nodesById"] | undefined
  let cachedRootIds: SqlAutocompleteState["rootIds"] | undefined
  let cachedLoading: SqlAutocompleteState["loading"] | undefined
  let cachedLoaded: SqlAutocompleteState["loaded"] | undefined
  let cachedIndex: ReturnType<typeof buildSqlSchemaIndex> | undefined

  const getIndex = () => {
    const state = options.getState()
    if (
      cachedIndex &&
      cachedNodesById === state.nodesById &&
      cachedRootIds === state.rootIds &&
      cachedLoading === state.loading &&
      cachedLoaded === state.loaded
    ) {
      return cachedIndex
    }

    cachedNodesById = state.nodesById
    cachedRootIds = state.rootIds
    cachedLoading = state.loading
    cachedLoaded = state.loaded
    cachedIndex = buildSqlSchemaIndex(state)
    return cachedIndex
  }

  return {
    getCompletions: ({ text, cursor }) => {
      const state = options.getState()
      return getSqlAutocompleteResult({
        text,
        cursorOffset: cursor,
        dialect: resolveSqlDialect(state.nodesById, state.rootIds),
        schema: getIndex(),
      })
    },
  }
}
