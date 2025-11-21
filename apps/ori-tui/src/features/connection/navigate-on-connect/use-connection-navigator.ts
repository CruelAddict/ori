import { createEffect, createSignal, type Accessor } from "solid-js";
import type { Configuration } from "@src/entities/configuration/model/configuration";
import { useConnectionState } from "@src/entities/connection/model/connection-state";
import { connectionRoute } from "@app/routes/types";
import { useRouteNavigation } from "@app/routes/router";


interface ConnectionNavigator {
    pendingConfigurationName: Accessor<string | null>;
    requestNavigation(configuration: Configuration): void;
    cancelPending(): void;
}

let navigatorInstance: ConnectionNavigator | undefined;

export function useConnectionNavigator(): ConnectionNavigator {
    if (!navigatorInstance) {
        navigatorInstance = createConnectionNavigator();
    }
    return navigatorInstance;
}

function createConnectionNavigator(): ConnectionNavigator {
    const connectionState = useConnectionState();
    const navigation = useRouteNavigation();
    const [pendingConfigurationName, setPendingConfigurationName] = createSignal<string | null>(null);

    const navigateToConnection = (configurationName: string) => {
        const pages = navigation.stack();
        const depth = pages.length;
        const top = pages[depth - 1];

        const targetRoute = connectionRoute(configurationName);

        if (depth === 1) {
            navigation.push(targetRoute);
            return;
        }

        if (depth === 2) {
            if (top?.type === "connection") {
                if (top.configurationName !== configurationName) {
                    navigation.replace(targetRoute);
                }
            } else {
                navigation.push(targetRoute);
            }
        }
    };

    const cancelPending = () => setPendingConfigurationName(null);

    createEffect(() => {
        const pendingName = pendingConfigurationName();
        if (!pendingName) {
            return;
        }
        const records = connectionState.records();
        const record = records[pendingName];
        if (!record) {
            return;
        }
        if (record.status === "connected") {
            navigateToConnection(pendingName);
            cancelPending();
            return;
        }
        if (record.status === "failed") {
            cancelPending();
        }
    });

    const requestNavigation = (configuration: Configuration) => {
        const { name } = configuration;
        const record = connectionState.getRecord(name);

        if (record?.status === "connected") {
            navigateToConnection(name);
            return;
        }

        setPendingConfigurationName(name);

        if (!record || record.status === "idle" || record.status === "failed") {
            void connectionState.connect(configuration);
        }
    };

    return {
        pendingConfigurationName,
        requestNavigation,
        cancelPending,
    };
}
