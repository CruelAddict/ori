import type { JSX } from "solid-js";
import { createContext, createEffect, createMemo, createResource, useContext } from "solid-js";
import type { Accessor } from "solid-js";
import type { Configuration } from "@src/lib/configuration";
import { useOriClient } from "@src/providers/client";
import { useLogger } from "@src/providers/logger";

interface ConfigurationsContextValue {
    configurations: Accessor<Configuration[]>;
    configurationMap: Accessor<Map<string, Configuration>>;
    loading: Accessor<boolean>;
    error: Accessor<string | null>;
    refresh: () => Promise<Configuration[] | undefined>;
}

const ConfigurationsContext = createContext<ConfigurationsContextValue>();

export interface ConfigurationsProviderProps {
    children: JSX.Element;
}

export function ConfigurationsProvider(props: ConfigurationsProviderProps) {
    const client = useOriClient();
    const logger = useLogger();

    const [configResource, { refetch }] = createResource<Configuration[]>(
        () => client,
        async (oriClient) => {
            const configurations = await oriClient.listConfigurations();
            return configurations;
        }
    );

    const configurations = createMemo(() => configResource() ?? []);
    const configurationMap = createMemo(() => {
        const map = new Map<string, Configuration>();
        for (const configuration of configurations()) {
            map.set(configuration.name, configuration);
        }
        return map;
    });
    const loading = createMemo(() => configResource.loading);
    const error = createMemo(() => {
        const err = configResource.error;
        if (!err) return null;
        return err instanceof Error ? err.message : String(err);
    });

    createEffect(() => {
        const err = configResource.error;
        if (err) {
            logger.error({ err }, "failed to load configurations");
        }
    });

    const refresh = async () => {
        const result = await refetch();
        return result;
    };

    const value: ConfigurationsContextValue = {
        configurations,
        configurationMap,
        loading,
        error,
        refresh,
    };

    return (
        <ConfigurationsContext.Provider value={value}>
            {props.children}
        </ConfigurationsContext.Provider>
    );
}

export function useConfigurations(): ConfigurationsContextValue {
    const ctx = useContext(ConfigurationsContext);
    if (!ctx) {
        throw new Error("ConfigurationsProvider is missing in component tree");
    }
    return ctx;
}

export function useConfigurationByName(name: Accessor<string | null>) {
    const ctx = useConfigurations();
    return createMemo(() => {
        const key = name();
        if (!key) return undefined;
        return ctx.configurationMap().get(key);
    });
}
