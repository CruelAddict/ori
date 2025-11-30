import { ROOT_ROUTE, type RouteLocation } from "@app/routes/types";
import { type Accessor, createMemo, createSignal } from "solid-js";

export type NavigationStore = {
    stack: Accessor<RouteLocation[]>;
    current: Accessor<RouteLocation>;
    depth: Accessor<number>;
    push(page: RouteLocation): void;
    pop(): void;
    replace(page: RouteLocation): void;
    reset(pages?: RouteLocation[]): void;
};

export function createNavigationStore(): NavigationStore {
    const [stack, setStack] = createSignal<RouteLocation[]>([ROOT_ROUTE]);

    const push = (page: RouteLocation) => {
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

    const replace = (page: RouteLocation) => {
        setStack((prev) => {
            if (!prev.length) {
                return [page];
            }
            return [...prev.slice(0, -1), page];
        });
    };

    const reset = (pages?: RouteLocation[]) => {
        setStack(() => {
            if (pages?.length) {
                return [...pages];
            }
            return [ROOT_ROUTE];
        });
    };

    const stackAccessor: Accessor<RouteLocation[]> = stack;
    const current = createMemo<RouteLocation>(() => {
        const pages = stackAccessor();
        return pages[pages.length - 1] ?? ROOT_ROUTE;
    });
    const depth = createMemo(() => stackAccessor().length);

    return {
        stack: stackAccessor,
        current,
        depth,
        push,
        pop,
        replace,
        reset,
    };
}
