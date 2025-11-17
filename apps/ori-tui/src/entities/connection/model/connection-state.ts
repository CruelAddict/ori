import type { Accessor } from "solid-js";
import { createContext, createEffect, createMemo, onCleanup, useContext } from "solid-js";
import { createStore } from "solid-js/store";
import type { Configuration } from "@src/entities/configuration/model/configuration";
import type { ConnectResult } from "@src/shared/lib/configurations-client";
import { useOriClient } from "@src/providers/client";
import { useLogger } from "@src/providers/logger";
import { useConfigurations } from "@src/entities/configuration/model/configuration-list-store";
import { CONNECTION_STATE_EVENT, type ServerEvent } from "@src/lib/events";

export type ConnectionLifecycle = "idle" | "requesting" | "waiting" | "connected" | "failed";

export interface ConnectionRecord {
    configuration: Configuration;
    status: ConnectionLifecycle;
    message?: string;
    error?: string;
    lastUpdated: number;
}

interface ConnectionStateStore {
    records: Record<string, ConnectionRecord>;
}

interface ConnectionActions {
    connect(configuration: Configuration): Promise<void>;
    clear(configurationName: string): void;
}

interface ConnectionStateContextValue extends ConnectionActions {
    records: Accessor<Record<string, ConnectionRecord>>;
    getRecord: (configurationName: string) => ConnectionRecord | undefined;
}

export const ConnectionStateContext = createContext<ConnectionStateContextValue>();

export function createConnectionStateContextValue(): ConnectionStateContextValue {
    const client = useOriClient();
    const logger = useLogger();
    const { configurationMap } = useConfigurations();

    const [state, setState] = createStore<ConnectionStateStore>({
        records: {},
    });

    const getRecord = (configurationName: string) => state.records[configurationName];

    const resolveConfiguration = (configurationName: string): Configuration | undefined => {
        return state.records[configurationName]?.configuration ?? configurationMap().get(configurationName);
    };

    const setRecord = (
        configurationName: string,
        recipe: (current: ConnectionRecord) => ConnectionRecord,
        options?: { configuration?: Configuration }
    ) => {
        setState("records", configurationName, (current) => {
            const configuration =
                current?.configuration ?? options?.configuration ?? resolveConfiguration(configurationName);
            if (!configuration) {
                logger.warn(
                    { configuration: configurationName },
                    "connection state update skipped for unknown configuration"
                );
                return current;
            }
            const base =
                current ?? ({
                    configuration,
                    status: "idle",
                    lastUpdated: Date.now(),
                } satisfies ConnectionRecord);
            return recipe(base);
        });
    };

    const clear = (configurationName: string) => {
        setState("records", (records) => {
            const next = { ...records };
            delete next[configurationName];
            return next;
        });
    };

    const handleConnectResult = (
        configurationName: string,
        configuration: Configuration,
        result: ConnectResult
    ) => {
        if (result.result === "success") {
            setRecord(
                configurationName,
                (current) => ({
                    ...current,
                    configuration,
                    status: "connected",
                    message: undefined,
                    error: undefined,
                    lastUpdated: Date.now(),
                }),
                { configuration }
            );
            return;
        }

        if (result.result === "fail") {
            setRecord(
                configurationName,
                (current) => ({
                    ...current,
                    configuration,
                    status: "failed",
                    message: result.userMessage,
                    error: result.userMessage,
                    lastUpdated: Date.now(),
                }),
                { configuration }
            );
            return;
        }

        setRecord(
            configurationName,
            (current) => ({
                ...current,
                configuration,
                status: "waiting",
                message: result.userMessage ?? "Waiting for backend...",
                error: undefined,
                lastUpdated: Date.now(),
            }),
            { configuration }
        );
    };

    const connect = async (configuration: Configuration) => {
        const { name } = configuration;
        setRecord(
            name,
            (current) => ({
                ...current,
                configuration,
                status: "requesting",
                message: "Requesting connection...",
                error: undefined,
                lastUpdated: Date.now(),
            }),
            { configuration }
        );
        try {
            const result = await client.connect(name);
            handleConnectResult(name, configuration, result);
        } catch (err) {
            logger.error({ err, configuration: name }, "connect RPC error");
            setRecord(
                name,
                (current) => ({
                    ...current,
                    configuration,
                    status: "failed",
                    message: "Connection attempt failed",
                    error: err instanceof Error ? err.message : String(err),
                    lastUpdated: Date.now(),
                }),
                { configuration }
            );
        }
    };

    const handleServerEvent = (event: ServerEvent) => {
        if (event.type !== CONNECTION_STATE_EVENT) {
            return;
        }
        const { configurationName, state: lifecycle, message, error } = event.payload;
        const configuration = resolveConfiguration(configurationName);
        if (!configuration) {
            logger.warn(
                { configuration: configurationName, lifecycle },
                "received connection lifecycle event for unknown configuration"
            );
            return;
        }
        if (lifecycle === "connected") {
            setRecord(
                configurationName,
                (current) => ({
                    ...current,
                    configuration,
                    status: "connected",
                    message: undefined,
                    error: undefined,
                    lastUpdated: Date.now(),
                }),
                { configuration }
            );
            return;
        }
        if (lifecycle === "failed") {
            setRecord(
                configurationName,
                (current) => ({
                    ...current,
                    configuration,
                    status: "failed",
                    message: message ?? "Connection failed",
                    error: error ?? message,
                    lastUpdated: Date.now(),
                }),
                { configuration }
            );
            return;
        }
        if (lifecycle === "connecting") {
            setRecord(
                configurationName,
                (current) => ({
                    ...current,
                    configuration,
                    status: "waiting",
                    message: message ?? "Waiting for backend...",
                    error: undefined,
                    lastUpdated: Date.now(),
                }),
                { configuration }
            );
        }
    };

    createEffect(() => {
        const dispose = client.openEventStream(handleServerEvent);
        onCleanup(() => dispose());
    });

    const recordsAccessor: Accessor<Record<string, ConnectionRecord>> = () => state.records;

    return {
        records: recordsAccessor,
        getRecord,
        connect,
        clear,
    };
}

export function useConnectionState(): ConnectionStateContextValue {
    const ctx = useContext(ConnectionStateContext);
    if (!ctx) {
        throw new Error("ConnectionEntityProvider is missing in component tree");
    }
    return ctx;
}

export function useConnectionRecord(configurationName: Accessor<string | null>) {
    const ctx = useConnectionState();
    return createMemo(() => {
        const name = configurationName();
        if (!name) return undefined;
        return ctx.getRecord(name);
    });
}
