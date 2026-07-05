import type { QueryJob } from "@usecase/query/usecase"
import { type Accessor, createContext, createMemo, createSignal, type JSX, useContext } from "solid-js"

export type AppPane = "explorer" | "editor" | "results"

export type AppResourceViewState = {
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
    currentJob: Accessor<QueryJob | undefined>
    isExecuting: Accessor<boolean>
  }
  results: {
    isFocused: Accessor<boolean>
    job: Accessor<QueryJob | undefined>
  }
}

export type AppStateContextValue = {
  resourceViews: Accessor<Record<string, AppResourceViewState>>
  activeResourceView: Accessor<AppResourceViewState | undefined>
  registerResourceView(state: AppResourceViewState): () => void
}

const AppStateContext = createContext<AppStateContextValue>()

export function AppStateProvider(props: { children: JSX.Element }) {
  const [resourceViews, setResourceViews] = createSignal<Record<string, AppResourceViewState>>({})
  const activeResourceView = createMemo(() => Object.values(resourceViews()).find((state) => state.isActive()))

  const registerResourceView = (state: AppResourceViewState) => {
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

  const value: AppStateContextValue = {
    resourceViews,
    activeResourceView,
    registerResourceView,
  }

  return <AppStateContext.Provider value={value}>{props.children}</AppStateContext.Provider>
}

export function useAppState(): AppStateContextValue {
  const ctx = useContext(AppStateContext)
  if (!ctx) {
    throw new Error("AppStateProvider is missing in component tree")
  }
  return ctx
}
