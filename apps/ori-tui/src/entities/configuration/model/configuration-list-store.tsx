import { useLogger } from "@app/providers/logger"
import { useConfigurationsService } from "@src/entities/configuration/api/configurations-service"
import type { Configuration } from "@src/entities/configuration/model/configuration"
import type { Accessor, JSX } from "solid-js"
import { createContext, createMemo, createSignal, onMount, useContext } from "solid-js"

type ConfigurationListStoreValue = {
  configurations: Accessor<Configuration[]>
  configurationMap: Accessor<Map<string, Configuration>>
  loading: Accessor<boolean>
  error: Accessor<string | null>
  refresh: () => Promise<void>
}

const ConfigurationListStoreContext = createContext<ConfigurationListStoreValue>()

export type ConfigurationListStoreProviderProps = {
  children: JSX.Element
}

export function ConfigurationListStoreProvider(props: ConfigurationListStoreProviderProps) {
  const service = useConfigurationsService()
  const logger = useLogger()
  const [configurations, setConfigurations] = createSignal<Configuration[]>([])
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)

  const configurationMap = createMemo(() => {
    const map = new Map<string, Configuration>()
    for (const configuration of configurations()) {
      map.set(configuration.name, configuration)
    }
    return map
  })

  let refreshPromise: Promise<void> | null = null
  const refresh = async () => {
    if (refreshPromise) {
      return refreshPromise
    }
    const promise = (async () => {
      setLoading(true)
      setError(null)
      try {
        const list = await service.listConfigurations()
        setConfigurations(list)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setError(message)
        logger.error({ err }, "failed to load configurations")
      } finally {
        setLoading(false)
        refreshPromise = null
      }
    })()
    refreshPromise = promise
    return promise
  }

  onMount(() => {
    void refresh()
  })

  const value: ConfigurationListStoreValue = {
    configurations,
    configurationMap,
    loading,
    error,
    refresh,
  }

  return <ConfigurationListStoreContext.Provider value={value}>{props.children}</ConfigurationListStoreContext.Provider>
}

export function useConfigurationListStore(): ConfigurationListStoreValue {
  const ctx = useContext(ConfigurationListStoreContext)
  if (!ctx) {
    throw new Error("ConfigurationListStoreProvider is missing in component tree")
  }
  return ctx
}

export function useConfigurations() {
  const store = useConfigurationListStore()
  return {
    configurations: store.configurations,
    configurationMap: store.configurationMap,
    loading: store.loading,
    error: store.error,
    refresh: store.refresh,
  }
}

export function useConfigurationByName(name: Accessor<string | null>) {
  const store = useConfigurationListStore()
  return createMemo(() => {
    const key = name()
    if (!key) return undefined
    return store.configurationMap().get(key)
  })
}
