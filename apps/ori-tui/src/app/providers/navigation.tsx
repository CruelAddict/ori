import { createContext, useContext, type JSX } from "solid-js";
import type { NavigationStore } from "@app/navigation/navigation-store";
import { createNavigationStore } from "@app/navigation/navigation-store";

const NavigationContext = createContext<NavigationStore>();

export function NavigationProvider(props: { children: JSX.Element }) {
    const store = createNavigationStore();
    return <NavigationContext.Provider value={store}>{props.children}</NavigationContext.Provider>;
}

export function useNavigation(): NavigationStore {
    const ctx = useContext(NavigationContext);
    if (!ctx) {
        throw new Error("NavigationProvider is missing in component tree");
    }
    return ctx;
}
