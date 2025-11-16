import type { JSX } from "solid-js";
import { ConfigurationsServiceProvider } from "@src/entities/configuration/api/configurations_service";
import { ConfigurationListStoreProvider } from "@src/entities/configuration/model/configuration_list_store";

export interface ConfigurationEntityProviderProps {
    children: JSX.Element;
}

export function ConfigurationEntityProvider(props: ConfigurationEntityProviderProps) {
    return (
        <ConfigurationsServiceProvider>
            <ConfigurationListStoreProvider>{props.children}</ConfigurationListStoreProvider>
        </ConfigurationsServiceProvider>
    );
}
