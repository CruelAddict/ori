import type { JSX } from "solid-js";
import { createContext, useContext } from "solid-js";
import type { OriClient, CreateClientOptions, ClientMode } from "@src/lib/configurationsClient";
import { createOriClient } from "@src/lib/configurationsClient";
import { useLogger } from "@src/providers/logger";

interface ClientContextValue {
    client: OriClient;
    mode: ClientMode;
    host?: string;
    port?: number;
    socketPath?: string;
}

const ClientContext = createContext<ClientContextValue>();

export interface ClientProviderProps {
    options: Omit<CreateClientOptions, "logger">;
    children: JSX.Element;
}

export function ClientProvider(props: ClientProviderProps) {
    const logger = useLogger();
    const client = createOriClient({ ...props.options, logger });
    const value: ClientContextValue = {
        client,
        mode: props.options.mode,
        host: props.options.host,
        port: props.options.port,
        socketPath: props.options.socketPath,
    };

    return <ClientContext.Provider value={value}>{props.children}</ClientContext.Provider>;
}

export function useOriClient(): OriClient {
    const ctx = useContext(ClientContext);
    if (!ctx) {
        throw new Error("ClientProvider is missing in component tree");
    }
    return ctx.client;
}

export function useClientInfo() {
    const ctx = useContext(ClientContext);
    if (!ctx) {
        throw new Error("ClientProvider is missing in component tree");
    }
    return ctx;
}
