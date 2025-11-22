import { createContext, useContext, type JSX } from "solid-js";
import { createConnectionNavigator, type ConnectionNavigator } from "./create-connection-navigator";

const ConnectionNavigatorContext = createContext<ConnectionNavigator>();

export interface ConnectionNavigatorProviderProps {
    children: JSX.Element;
}

export function ConnectionNavigatorProvider(props: ConnectionNavigatorProviderProps) {
    const navigator = createConnectionNavigator();
    return (
        <ConnectionNavigatorContext.Provider value={navigator}>
            {props.children}
        </ConnectionNavigatorContext.Provider>
    );
}

export function useConnectionNavigator(): ConnectionNavigator {
    const ctx = useContext(ConnectionNavigatorContext);
    if (!ctx) {
        throw new Error("ConnectionNavigatorProvider is missing in component tree");
    }
    return ctx;
}
