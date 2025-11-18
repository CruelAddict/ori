import type { JSX } from "solid-js";
import { createContext, useContext } from "solid-js";
import type { Configuration } from "@src/entities/configuration/model/configuration";
import { useOriClient } from "@app/providers/client";

export interface ConfigurationsService {
    listConfigurations(): Promise<Configuration[]>;
}

const ConfigurationsServiceContext = createContext<ConfigurationsService>();

export interface ConfigurationsServiceProviderProps {
    children: JSX.Element;
}

export function ConfigurationsServiceProvider(props: ConfigurationsServiceProviderProps) {
    const client = useOriClient();
    const service: ConfigurationsService = {
        listConfigurations: () => client.listConfigurations(),
    };

    return (
        <ConfigurationsServiceContext.Provider value={service}>
            {props.children}
        </ConfigurationsServiceContext.Provider>
    );
}

export function useConfigurationsService(): ConfigurationsService {
    const ctx = useContext(ConfigurationsServiceContext);
    if (!ctx) {
        throw new Error("ConfigurationsServiceProvider is missing in component tree");
    }
    return ctx;
}
