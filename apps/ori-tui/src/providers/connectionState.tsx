import type { JSX, Accessor } from "solid-js";
import { createContext, createEffect, createMemo, onCleanup, useContext } from "solid-js";
import { createStore } from "solid-js/store";
import type { Configuration } from "@src/lib/configuration";
import type { ConnectResult } from "@src/lib/configurationsClient";
import { useOriClient } from "@src/providers/client";
import { useLogger } from "@src/providers/logger";
import { useConfigurations } from "@src/providers/configurations";
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
    focusedConfigurationName: string | null;
}

interface ConnectionActions {
    connect(configuration: Configuration): Promise<void>;
    focus(configurationName: string | null): void;
    clear(configurationName: string): void;
}

interface ConnectionStateContextValue extends ConnectionActions {
    records: Accessor<Record<string, ConnectionRecord>>;
    getRecord: (configurationName: string) => ConnectionRecord | undefined;
    focusedConfigurationName: Accessor<string | null>;
}

const ConnectionStateContext = createContext<ConnectionStateContextValue>();

export interface ConnectionStateProviderProps {
    children: JSX.Element;
}

export function ConnectionStateProvider(props: ConnectionStateProviderProps) {
    const client = useOriClient();
    const logger = useLogger();
    const { configurationMap } = useConfigurations();

    const [state, setState] = createStore<ConnectionStateStore>({
        records: {},
        focusedConfigurationName: null,
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

    const focus = (configurationName: string | null) => {
        setState("focusedConfigurationName", configurationName);
    };

    const clear = (configurationName: string) => {
        setState("records", (records) => {
            const next = { ...records };
            delete next[configurationName];
            return next;
        });
        if (state.focusedConfigurationName === configurationName) {
            focus(null);
        }
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
            if (state.focusedConfigurationName !== configurationName) {
                focus(configurationName);
            }
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
            if (state.focusedConfigurationName !== configurationName) {
                focus(configurationName);
            }
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
    const focusedConfigurationName = () => state.focusedConfigurationName;

    const value: ConnectionStateContextValue = {
        records: recordsAccessor,
        getRecord,
        connect,
        focus,
        clear,
        focusedConfigurationName,
    };

    return (
        <ConnectionStateContext.Provider value={value}>
            {props.children}
        </ConnectionStateContext.Provider>
    );
}

export function useConnectionState(): ConnectionStateContextValue {
    const ctx = useContext(ConnectionStateContext);
    if (!ctx) {
        throw new Error("ConnectionStateProvider is missing in component tree");
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

