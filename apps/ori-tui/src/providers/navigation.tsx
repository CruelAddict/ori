import type { Accessor, Component, JSX } from "solid-js";
import { For, createContext, createMemo, createSignal, useContext } from "solid-js";

export interface ConfigurationListPage {
    type: "configuration-list";
}

export interface ConnectionPage {
    type: "connection";
    configurationName: string;
}

export type NavigationPage = ConfigurationListPage | ConnectionPage;

interface NavigationContextValue {
    stack: Accessor<NavigationPage[]>;
    current: Accessor<NavigationPage>;
    depth: Accessor<number>;
    push(page: NavigationPage): void;
    pop(): void;
    replace(page: NavigationPage): void;
    reset(pages?: NavigationPage[]): void;
}

export interface OverlayComponentProps {
    close: () => void;
}

export interface OverlayEntry {
    id: string;
    render: Component<OverlayComponentProps>;
}

interface OverlayContextValue {
    overlays: Accessor<OverlayEntry[]>;
    show(options: OverlayOptions): string;
    dismiss(id: string): void;
    dismissAll(): void;
}

export interface OverlayOptions {
    id?: string;
    render: Component<OverlayComponentProps>;
}

const ROOT_PAGE: ConfigurationListPage = { type: "configuration-list" };

const NavigationContext = createContext<NavigationContextValue>();
const OverlayContext = createContext<OverlayContextValue>();

let overlayIdCounter = 0;

export interface NavigationProviderProps {
    children: JSX.Element;
}

export function NavigationProvider(props: NavigationProviderProps) {
    const [stack, setStack] = createSignal<NavigationPage[]>([ROOT_PAGE]);

    const push = (page: NavigationPage) => {
        setStack((prev) => [...prev, page]);
    };

    const pop = () => {
        setStack((prev) => {
            if (prev.length <= 1) {
                return prev;
            }
            return prev.slice(0, -1);
        });
    };

    const replace = (page: NavigationPage) => {
        setStack((prev) => {
            if (!prev.length) {
                return [page];
            }
            return [...prev.slice(0, -1), page];
        });
    };

    const reset = (pages?: NavigationPage[]) => {
        setStack(() => {
            if (pages?.length) {
                return [...pages];
            }
            return [ROOT_PAGE];
        });
    };

    const stackAccessor: Accessor<NavigationPage[]> = stack;
    const current = createMemo<NavigationPage>(() => {
        const pages = stackAccessor();
        return pages[pages.length - 1] ?? ROOT_PAGE;
    });
    const depth = createMemo(() => stackAccessor().length);

    const navigationValue: NavigationContextValue = {
        stack: stackAccessor,
        current,
        depth,
        push,
        pop,
        replace,
        reset,
    };

    const [overlays, setOverlays] = createSignal<OverlayEntry[]>([]);

    const show = (options: OverlayOptions) => {
        const id = options.id ?? `overlay-${++overlayIdCounter}`;
        setOverlays((prev) => [...prev, { id, render: options.render }]);
        return id;
    };

    const dismiss = (id: string) => {
        setOverlays((prev) => prev.filter((entry) => entry.id !== id));
    };

    const dismissAll = () => {
        setOverlays([]);
    };

    const overlayValue: OverlayContextValue = {
        overlays,
        show,
        dismiss,
        dismissAll,
    };

    return (
        <NavigationContext.Provider value={navigationValue}>
            <OverlayContext.Provider value={overlayValue}>{props.children}</OverlayContext.Provider>
        </NavigationContext.Provider>
    );
}

export function useNavigation(): NavigationContextValue {
    const ctx = useContext(NavigationContext);
    if (!ctx) {
        throw new Error("NavigationProvider is missing in component tree");
    }
    return ctx;
}

export function useOverlayManager(): OverlayContextValue {
    const ctx = useContext(OverlayContext);
    if (!ctx) {
        throw new Error("NavigationProvider is missing in component tree");
    }
    return ctx;
}

export function OverlayHost() {
    const overlays = useOverlayManager();
    return (
        <For each={overlays.overlays()}>
            {(entry) => {
                const Render = entry.render;
                return <Render close={() => overlays.dismiss(entry.id)} />;
            }}
        </For>
    );
}
