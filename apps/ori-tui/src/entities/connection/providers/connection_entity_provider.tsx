import type { JSX } from "solid-js";
import {
    ConnectionStateContext,
    createConnectionStateContextValue,
} from "@src/entities/connection/model/connection_state";

export interface ConnectionEntityProviderProps {
    children: JSX.Element;
}

export function ConnectionEntityProvider(props: ConnectionEntityProviderProps) {
    const value = createConnectionStateContextValue();

    return (
        <ConnectionStateContext.Provider value={value}>
            {props.children}
        </ConnectionStateContext.Provider>
    );
}
