import type { JSX, Accessor } from "solid-js";
import { createContext, createEffect, createMemo, createSignal, onMount, useContext } from "solid-js";
import type { Configuration } from "@src/entities/configuration/model/configuration";
import { useLogger } from "@src/providers/logger";
import { useConfigurationsService } from "@src/entities/configuration/api/configurations-service";

interface ConfigurationListStoreValue {
    configurations: Accessor<Configuration[]>;
    configurationMap: Accessor<Map<string, Configuration>>;
    loading: Accessor<boolean>;
    error: Accessor<string | null>;
    selectedIndex: Accessor<number>;
    refresh: () => Promise<void>;
    moveSelection: (delta: number) => void;
    selectIndex: (index: number) => void;
}

const ConfigurationListStoreContext = createContext<ConfigurationListStoreValue>();

export interface ConfigurationListStoreProviderProps {
    children: JSX.Element;
}

export function ConfigurationListStoreProvider(props: ConfigurationListStoreProviderProps) {
    const service = useConfigurationsService();
    const logger = useLogger();
    const [configurations, setConfigurations] = createSignal<Configuration[]>([]);
    const [loading, setLoading] = createSignal(true);
    const [error, setError] = createSignal<string | null>(null);
    const [selectedIndex, setSelectedIndex] = createSignal(0);

    const configurationMap = createMemo(() => {
        const map = new Map<string, Configuration>();
        for (const configuration of configurations()) {
            map.set(configuration.name, configuration);
        }
        return map;
    });

    const clampIndex = (index: number) => {
        const list = configurations();
        if (!list.length) {
            return 0;
        }
        return Math.max(0, Math.min(list.length - 1, index));
    };

    let refreshPromise: Promise<void> | null = null;
    const refresh = async () => {
        if (refreshPromise) {
            return refreshPromise;
        }
        const promise = (async () => {
            setLoading(true);
            setError(null);
            try {
                const list = await service.listConfigurations();
                setConfigurations(list);
                setSelectedIndex((prev) => clampIndex(prev));
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                setError(message);
                logger.error({ err }, "failed to load configurations");
            } finally {
                setLoading(false);
                refreshPromise = null;
            }
        })();
        refreshPromise = promise;
        return promise;
    };

    onMount(() => {
        void refresh();
    });

    createEffect(() => {
        const list = configurations();
        if (!list.length) {
            setSelectedIndex(0);
            return;
        }
        setSelectedIndex((prev) => clampIndex(prev));
    });

    const moveSelection = (delta: number) => {
        const list = configurations();
        if (!list.length) {
            return;
        }
        setSelectedIndex((prev) => clampIndex(prev + delta));
    };

    const selectIndex = (index: number) => {
        const list = configurations();
        if (!list.length) {
            setSelectedIndex(0);
            return;
        }
        setSelectedIndex(clampIndex(index));
    };

    const value: ConfigurationListStoreValue = {
        configurations,
        configurationMap,
        loading,
        error,
        selectedIndex,
        refresh,
        moveSelection,
        selectIndex,
    };

    return (
        <ConfigurationListStoreContext.Provider value={value}>
            {props.children}
        </ConfigurationListStoreContext.Provider>
    );
}

export function useConfigurationListStore(): ConfigurationListStoreValue {
    const ctx = useContext(ConfigurationListStoreContext);
    if (!ctx) {
        throw new Error("ConfigurationListStoreProvider is missing in component tree");
    }
    return ctx;
}

export function useConfigurations() {
    const store = useConfigurationListStore();
    return {
        configurations: store.configurations,
        configurationMap: store.configurationMap,
        loading: store.loading,
        error: store.error,
        refresh: store.refresh,
    };
}

export function useConfigurationByName(name: Accessor<string | null>) {
    const store = useConfigurationListStore();
    return createMemo(() => {
        const key = name();
        if (!key) return undefined;
        return store.configurationMap().get(key);
    });
}
