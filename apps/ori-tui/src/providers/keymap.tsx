import type { JSX, Accessor } from "solid-js";
import { createContext, createEffect, onCleanup, useContext } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import type { KeyEvent } from "@opentui/core";
import { Keybind, type KeyboardEventLike, useKeybind } from "@src/lib/keybind";

interface KeyBinding {
    pattern: string;
    handler: (event: KeyEvent) => void;
    description?: string;
    when?: () => boolean;
    preventDefault?: boolean;
    priority?: number;
    mode?: "normal" | "leader";
}

interface KeymapEntry extends KeyBinding {
    id: number;
    scope?: string;
}

interface KeymapContextValue {
    register: (binding: KeyBinding, scope?: string) => () => void;
}

const KeymapContext = createContext<KeymapContextValue>();

export interface KeymapProviderProps {
    children: JSX.Element;
}

export function KeymapProvider(props: KeymapProviderProps) {
    const parser = useKeybind();
    let bindings: KeymapEntry[] = [];
    let nextId = 1;

    const register = (binding: KeyBinding, scope?: string) => {
        const entry: KeymapEntry = { ...binding, scope, id: nextId++ };
        bindings = [...bindings, entry];
        return () => {
            bindings = bindings.filter((item) => item.id !== entry.id);
        };
    };

    let awaitingLeader = false;

    const exitLeaderMode = () => {
        awaitingLeader = false;
    };

    useKeyboard((evt) => {
        const parsed = parser.parse(evt as KeyboardEventLike);

        if (!awaitingLeader && parsed.ctrl && parsed.name === "x") {
            awaitingLeader = true;
            evt.preventDefault?.();
            return;
        }

        const snapshots = [...bindings].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
        const activeMode: "normal" | "leader" = awaitingLeader ? "leader" : "normal";

        for (const entry of snapshots) {
            const entryMode = entry.mode ?? "normal";
            if (entryMode !== activeMode) {
                continue;
            }
            if (entry.when && !entry.when()) {
                continue;
            }
            if (!Keybind.match(entry.pattern, parsed)) {
                continue;
            }
            if (entry.preventDefault || awaitingLeader) {
                evt.preventDefault?.();
            }
            entry.handler(evt);
            if (awaitingLeader) {
                exitLeaderMode();
            }
            return;
        }

        if (awaitingLeader) {
            evt.preventDefault?.();
            exitLeaderMode();
        }
    });

    const value: KeymapContextValue = { register };

    return <KeymapContext.Provider value={value}>{props.children}</KeymapContext.Provider>;
}

export function useKeymapContext(): KeymapContextValue {
    const ctx = useContext(KeymapContext);
    if (!ctx) {
        throw new Error("KeymapProvider is missing in component tree");
    }
    return ctx;
}

export function useScopedKeymap(scope: string, bindings: KeyBinding[] | Accessor<KeyBinding[]>) {
    const ctx = useKeymapContext();
    createEffect(() => {
        const resolved = typeof bindings === "function" ? bindings() : bindings;
        const cleanups = resolved.map((binding) => ctx.register(binding, scope));
        onCleanup(() => cleanups.forEach((cleanup) => cleanup()));
    });
}

export type { KeyBinding };
