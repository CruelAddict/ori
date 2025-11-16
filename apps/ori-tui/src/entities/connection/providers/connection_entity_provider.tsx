import type { JSX } from "solid-js";
import { ConnectionStateProvider } from "@src/entities/connection/model/connection_state";

export interface ConnectionEntityProviderProps {
    children: JSX.Element;
}

export function ConnectionEntityProvider(props: ConnectionEntityProviderProps) {
    return <ConnectionStateProvider>{props.children}</ConnectionStateProvider>;
}
