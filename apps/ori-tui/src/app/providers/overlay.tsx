import { createContext, useContext, type JSX } from "solid-js";
import type { OverlayManager } from "@app/overlay/overlay-store";
import { createOverlayManager } from "@app/overlay/overlay-store";

const OverlayContext = createContext<OverlayManager>();

export function OverlayProvider(props: { children: JSX.Element }) {
    const manager = createOverlayManager();
    return <OverlayContext.Provider value={manager}>{props.children}</OverlayContext.Provider>;
}

export function useOverlayManager(): OverlayManager {
    const ctx = useContext(OverlayContext);
    if (!ctx) {
        throw new Error("OverlayProvider is missing in component tree");
    }
    return ctx;
}
