import { createEffect, createSignal, type Accessor } from "solid-js";
import type { Configuration } from "@src/entities/configuration/model/configuration";
import { useConnectionState } from "@src/entities/connection/model/connection_state";
import { useNavigation } from "@src/providers/navigation";

interface ConnectionNavigator {
    pendingConfigurationName: Accessor<string | null>;
    requestNavigation(configuration: Configuration): void;
    cancelPending(): void;
}

export function useConnectionNavigator(): ConnectionNavigator {
    const connectionState = useConnectionState();
    const navigation = useNavigation();
    const [pendingConfigurationName, setPendingConfigurationName] = createSignal<string | null>(null);

    const navigateToConnection = (configurationName: string) => {
        const pages = navigation.stack();
        const depth = pages.length;
        const top = pages[depth - 1];

        if (depth === 1) {
            navigation.push({ type: "connection", configurationName });
            return;
        }

        if (depth === 2) {
            if (top?.type === "connection") {
                if (top.configurationName !== configurationName) {
                    navigation.replace({ type: "connection", configurationName });
                }
            } else {
                navigation.push({ type: "connection", configurationName });
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
