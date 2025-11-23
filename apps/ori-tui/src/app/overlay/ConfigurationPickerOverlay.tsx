import { createEffect, createMemo, createSignal } from "solid-js";
import type { OverlayComponentProps } from "@app/overlay/overlay-store";
import { DialogSelect, type DialogSelectOption } from "@widgets/dialog-select";
import type { Configuration } from "@src/entities/configuration/model/configuration";
import { useConfigurationListStore } from "@src/entities/configuration/model/configuration-list-store";
import {
    useConnectionState,
    type ConnectionRecord,
} from "@src/entities/connection/model/connection-state";
import { useRouteNavigation } from "@app/routes/router";
import { connectionRoute } from "@app/routes/types";

function formatConfigurationDetails(configuration: Configuration) {
    return `${configuration.type}`;
}

function formatStatusBadge(record: ConnectionRecord | undefined) {
    if (!record) return undefined;
    if (record.status === "connected") return "connected";
    if (record.status === "requesting" || record.status === "waiting") return "connecting";
    if (record.status === "failed") return "failed";
    return undefined;
}

export function ConfigurationPickerOverlay(props: OverlayComponentProps) {
    const store = useConfigurationListStore();
    const connectionState = useConnectionState();
    const navigation = useRouteNavigation();
    const [pendingName, setPendingName] = createSignal<string | null>(null);

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
            } satisfies DialogSelectOption<Configuration>;
        });
    });

    const navigateToConfiguration = (configurationName: string) => {
        navigation.push(connectionRoute(configurationName));
        setPendingName(null);
        props.close();
    };

    createEffect(() => {
        const intent = pendingName();
        if (!intent) return;
        const records = connectionState.records();
        const record = records[intent];
        if (!record) return;
        if (record.status === "connected") {
            navigateToConfiguration(intent);
        }
    });

    const handleSelect = (option: DialogSelectOption<Configuration>) => {
        const name = option.value.name;
        setPendingName(name);
        const records = connectionState.records();
        const record = records[name];

        if (record?.status === "connected") {
            navigateToConfiguration(name);
            return;
        }

        if (!record || record.status === "idle" || record.status === "failed") {
            void connectionState.connect(option.value);
        }
    };

    const handleCancel = () => {
        setPendingName(null);
        props.close();
    };

    return (
        <DialogSelect
            scopeId="configuration-picker"
            title="Select database"
            placeholder="Type to search"
            emptyMessage="No configurations available"
            width={80}
            maxHeight={16}
            options={options}
            selectedId={pendingName}
            onSelect={handleSelect}
            onCancel={handleCancel}
        />
    );
}
