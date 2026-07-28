import type { QueryJob } from "@usecase/query/usecase"
import type { ResultSourcePage } from "@usecase/result-source/usecase"
import { type Accessor, createContext, createMemo, createSignal, type JSX, useContext } from "solid-js"

export type AppPane = "explorer" | "editor" | "results"

export type AppResourceView = {
  resourceName: Accessor<string>
  title: Accessor<string>
  isActive: Accessor<boolean>
  focusedPane: Accessor<AppPane | null>
  visiblePanes: Accessor<Record<AppPane, boolean>>
  explorer: {
    isFocused: Accessor<boolean>
    loading: Accessor<boolean>
    error: Accessor<string | null>
    mode: Accessor<string>
    filter: Accessor<string>
    selectedId: Accessor<string | null>
  }
  editor: {
    isFocused: Accessor<boolean>
    filePath: Accessor<string>
    queryText: Accessor<string>
  }
  results: {
    isFocused: Accessor<boolean>
    job: Accessor<QueryJob | undefined>
    pagination: Accessor<ResultSourcePage | undefined>
    isNavigating: Accessor<boolean>
    canLoadFirstPage: Accessor<boolean>
    canLoadPreviousPage: Accessor<boolean>
    canLoadNextPage: Accessor<boolean>
    canLoadLastPage: Accessor<boolean>
    loadFirstPage: () => void
    loadPreviousPage: () => void
    loadNextPage: () => void
    loadLastPage: () => void
  }
}

export type AppContextValue = {
  resourceViews: Accessor<Record<string, AppResourceView>>
  activeResourceView: Accessor<AppResourceView | undefined>
  registerResourceView(state: AppResourceView): () => void
}

const AppContext = createContext<AppContextValue>()

export function AppContextProvider(props: { children: JSX.Element }) {
  const [resourceViews, setResourceViews] = createSignal<Record<string, AppResourceView>>({})
  const activeResourceView = createMemo(() => Object.values(resourceViews()).find((state) => state.isActive()))

  const registerResourceView = (state: AppResourceView) => {
    const name = state.resourceName()
    setResourceViews((current) => ({
      ...current,
      [name]: state,
    }))

    return () => {
      setResourceViews((current) => {
        if (current[name] !== state) {
          return current
        }
        const next = { ...current }
        delete next[name]
        return next
      })
    }
  }

  const value: AppContextValue = {
    resourceViews,
    activeResourceView,
    registerResourceView,
  }

  return <AppContext.Provider value={value}>{props.children}</AppContext.Provider>
}

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) {
    throw new Error("AppContextProvider is missing in component tree")
  }
  return ctx
}
