import { createMemo } from "solid-js";
import type { OverlayComponentProps } from "@app/overlay/overlay-store";
import { DialogSelect, useDialogSelect, type DialogSelectOption } from "@widgets/dialog-select";
import type { Configuration } from "@src/entities/configuration/model/configuration";
import { useConfigurationListStore } from "@src/entities/configuration/model/configuration-list-store";
import {
    useConnectionState,
    type ConnectionRecord,
} from "@src/entities/connection/model/connection-state";
import { useConnectionNavigator } from "@src/features/connection/navigate-on-connect/use-connection-navigator";

function formatConfigurationDetails(configuration: Configuration) {
    return `${configuration.type} • ${configuration.host}:${configuration.port}/${configuration.database}`;
}

function formatStatusBadge(record: ConnectionRecord | undefined) {
    if (!record) return undefined;
    if (record.status === "connected") return "Connected";
    if (record.status === "requesting" || record.status === "waiting") return "Connecting";
    if (record.status === "failed") return "Failed";
    return undefined;
}

function formatStatusFooter(record: ConnectionRecord | undefined) {
    if (!record) return undefined;
    if (record.status === "connected") {
        return "Connected";
    }
    if (record.status === "failed") {
        return record.message ?? record.error ?? "Connection failed";
    }
    if (record.status === "requesting") {
        return record.message ?? "Requesting connection…";
    }
    if (record.status === "waiting") {
        return record.message ?? "Waiting for backend…";
    }
    return undefined;
}

export function ConfigurationPickerOverlay(props: OverlayComponentProps) {
    const store = useConfigurationListStore();
    const connectionState = useConnectionState();
    const connectionNavigator = useConnectionNavigator();

    const selectedConfiguration = createMemo(() => {
        const list = store.configurations();
        const index = store.selectedIndex();
        return list[index] ?? null;
    });

    const options = createMemo<DialogSelectOption<Configuration>[]>(() => {
        const list = store.configurations();
        const records = connectionState.records();
        return list.map((configuration) => {
            const record = records[configuration.name];
            return {
                id: configuration.name,
                title: configuration.name,
                description: formatConfigurationDetails(configuration),
                value: configuration,
                badge: formatStatusBadge(record),
                footer: formatStatusFooter(record),
            } satisfies DialogSelectOption<Configuration>;
        });
    });

    const viewModel = useDialogSelect<Configuration>({
        options,
        selectedValue: selectedConfiguration,
        equals: (a, b) => a?.name === b?.name,
        limit: Number.POSITIVE_INFINITY,
        pageSize: 9,
    });

    const highlightedRecord = createMemo(() => {
        const option = viewModel.selected();
        if (!option) return undefined;
        const records = connectionState.records();
        return records[option.value.name];
    });

    const connectBanner = createMemo(() => {
        const record = highlightedRecord();
        if (!record) return "Select a configuration to connect";
        if (record.status === "requesting") {
            return record.message ?? "Contacting backend…";
        }
        if (record.status === "waiting") {
            return record.message ?? "Waiting for server event…";
        }
        if (record.status === "failed") {
            return record.message ?? record.error ?? "Connection failed";
        }
        if (record.status === "connected") {
            return "Connected — press Enter to focus session";
        }
        return "Select a configuration to connect";
    });

    const updateSelection = (option?: DialogSelectOption<Configuration>) => {
        if (!option) return;
        const list = store.configurations();
        const index = list.findIndex((configuration) => configuration.name === option.value.name);
        if (index >= 0) {
            store.selectIndex(index);
        }
    };

    const handleSelect = (option: DialogSelectOption<Configuration>) => {
        updateSelection(option);
        connectionNavigator.requestNavigation(option.value);
        props.close();
    };

    return (
        <DialogSelect
            scopeId="configuration-picker"
            title="Switch Configuration"
            description={connectBanner()}
            placeholder="Type a configuration name"
            emptyMessage="No configurations available"
            width={80}
            maxHeight={16}
            viewModel={viewModel}
            onSelect={handleSelect}
            onCancel={props.close}
            onHighlightChange={(option) => updateSelection(option)}
        />
    );
}
