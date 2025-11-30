import { ConfigurationsServiceProvider } from "@src/entities/configuration/api/configurations-service";
import { ConfigurationListStoreProvider } from "@src/entities/configuration/model/configuration-list-store";
import type { JSX } from "solid-js";

export type ConfigurationEntityProviderProps = {
    children: JSX.Element;
};

export function ConfigurationEntityProvider(props: ConfigurationEntityProviderProps) {
    return (
        <ConfigurationsServiceProvider>
            <ConfigurationListStoreProvider>{props.children}</ConfigurationListStoreProvider>
        </ConfigurationsServiceProvider>
    );
}
