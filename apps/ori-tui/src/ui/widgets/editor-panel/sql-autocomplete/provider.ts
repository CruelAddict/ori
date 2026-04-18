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
  let cachedKey = ""
  let cachedIndex: ReturnType<typeof buildSqlSchemaIndex> | undefined

  const getIndex = () => {
    const state = options.getState()
    const key = `${Object.keys(state.nodesById).length}:${state.rootIds.join(",")}:${state.loading ? 1 : 0}:${state.loaded ? 1 : 0}`
    if (cachedIndex && cachedKey === key) {
      return cachedIndex
    }

    cachedKey = key
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
