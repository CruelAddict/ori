import { createMemo } from "solid-js";
import type { Accessor } from "solid-js";
import type { Configuration } from "@src/lib/configuration";
import { useConfigurationListStore } from "@src/core/stores/configurationListStore";
import { useConnectionState, type ConnectionRecord } from "@src/providers/connectionState";
import { useClientInfo } from "@src/providers/client";

export interface ConfigurationListViewModel {
    configurations: Accessor<Configuration[]>;
    loading: Accessor<boolean>;
    error: Accessor<string | null>;
    serverLabel: Accessor<string>;
    connectBanner: Accessor<string | null>;
    selectedIndex: Accessor<number>;
    rowStatus: (configuration: Configuration) => string;
    isSelected: (index: number) => boolean;
    helpText: string;
    actions: {
        moveUp: () => void;
        moveDown: () => void;
        pageUp: () => void;
        pageDown: () => void;
        select: () => void;
        refresh: () => Promise<void>;
    };
}

export function useConfigurationList(): ConfigurationListViewModel {
    const store = useConfigurationListStore();
    const connectionState = useConnectionState();
    const clientInfo = useClientInfo();

    const records = connectionState.records;

    const selectedConfiguration = createMemo(() => {
        const list = store.configurations();
        const index = store.selectedIndex();
        return list[index] ?? null;
    });

    const selectedRecord = createMemo<ConnectionRecord | undefined>(() => {
        const configuration = selectedConfiguration();
        if (!configuration) return undefined;
        return records()[configuration.name];
    });

    const serverLabel = createMemo(() => {
        return clientInfo.mode === "stub"
            ? "Stubbed backend (local fixtures)"
            : clientInfo.socketPath
            ? `Socket: ${clientInfo.socketPath}`
            : `Server: ${clientInfo.host ?? "localhost"}:${clientInfo.port ?? 8080}`;
    });

    const isBusy = (configuration: Configuration) => {
        const record = records()[configuration.name];
        if (!record) return false;
        return record.status === "requesting" || record.status === "waiting";
    };

    const rowStatus = (configuration: Configuration) => {
        const record = records()[configuration.name];
        if (!record) return "";
        if (record.status === "waiting") return " [waiting]";
        if (record.status === "requesting") return " [connecting]";
        if (record.status === "failed") return " [failed]";
        if (record.status === "connected") return " [connected]";
        return "";
    };

    const connectBanner = createMemo(() => {
        const record = selectedRecord();
        if (!record) return null;
        if (record.status === "requesting") {
            return record.message ?? "Contacting backend...";
        }
        if (record.status === "waiting") {
            return record.message ?? "Waiting for server event...";
        }
        if (record.status === "failed") {
            return record.message ?? record.error ?? "Connection failed";
        }
        return null;
    });

    const handleSelect = () => {
        const configuration = selectedConfiguration();
        if (!configuration) return;
        const record = records()[configuration.name];
        if (record?.status === "connected") {
            connectionState.focus(configuration.name);
            return;
        }
        if (isBusy(configuration)) {
            return;
        }
        void connectionState.connect(configuration);
    };

    const actions = {
        moveUp: () => store.moveSelection(-1),
        moveDown: () => store.moveSelection(1),
        pageUp: () => store.moveSelection(-10),
        pageDown: () => store.moveSelection(10),
        select: handleSelect,
        refresh: () => store.refresh(),
    };

    return {
        configurations: store.configurations,
        loading: store.loading,
        error: store.error,
        serverLabel,
        connectBanner,
        selectedIndex: store.selectedIndex,
        rowStatus,
        isSelected: (index: number) => index === store.selectedIndex(),
        helpText:
            "Use ↑/↓ arrows, j/k, Ctrl+N/P, PgUp/PgDn to navigate. Enter to connect or focus existing sessions.",
        actions,
    };
}
