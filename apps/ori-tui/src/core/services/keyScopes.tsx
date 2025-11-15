import type { JSX, Accessor, ParentComponent } from "solid-js";
import { createContext, createUniqueId, onCleanup, useContext } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import type { KeyEvent } from "@opentui/core";
import { KeyScopeStore, type KeyBinding } from "@src/core/stores/keyScopes";
import { Keybind, type KeyboardEventLike, useKeybind } from "@src/lib/keybind";

interface KeymapRuntime {
    store: KeyScopeStore;
}

const KeymapRuntimeContext = createContext<KeymapRuntime>();
const ParentScopeContext = createContext<string | null>(null);

export interface KeymapProviderProps {
    children: JSX.Element;
}

export const KeymapProvider: ParentComponent<KeymapProviderProps> = (props) => {
    const store = new KeyScopeStore();
    const parser = useKeybind();
    let awaitingLeader = false;

    useKeyboard((evt: KeyEvent) => {
        const parsed = parser.parse(evt as KeyboardEventLike);

        if (!awaitingLeader && parsed.ctrl && parsed.name === "x") {
            awaitingLeader = true;
            evt.preventDefault?.();
            return;
        }

        const mode: "normal" | "leader" = awaitingLeader ? "leader" : "normal";
        const scopes = store.getDispatchList();

        for (const scope of scopes) {
            const bindings = scope.getBindings();
            for (const binding of bindings) {
                const bindingMode = binding.mode ?? "normal";
                if (bindingMode !== mode) {
                    continue;
                }
                if (binding.when && !binding.when()) {
                    continue;
                }
                if (!Keybind.match(binding.pattern, parsed)) {
                    continue;
                }
                if (binding.preventDefault || awaitingLeader) {
                    evt.preventDefault?.();
                }
                binding.handler(evt);
                awaitingLeader = false;
                return;
            }
        }

        if (awaitingLeader) {
            evt.preventDefault?.();
            awaitingLeader = false;
        }
    });

    const runtime: KeymapRuntime = { store };

    return (
        <KeymapRuntimeContext.Provider value={runtime}>
            <ParentScopeContext.Provider value={null}>{props.children}</ParentScopeContext.Provider>
        </KeymapRuntimeContext.Provider>
    );
};

export interface KeyScopeProps {
    id?: string;
    bindings: KeyBinding[] | Accessor<KeyBinding[]>;
    enabled?: boolean | (() => boolean);
    priority?: number;
    children?: JSX.Element;
}

export function KeyScope(props: KeyScopeProps) {
    const runtime = useKeymapRuntime();
    const parentId = useContext(ParentScopeContext);
    const scopeId = props.id ?? createUniqueId();
    const bindingsProp = props.bindings;

    const bindingsAccessor: Accessor<KeyBinding[]> = isBindingsAccessor(bindingsProp)
        ? bindingsProp
        : () => bindingsProp;
    const enabledAccessor = () =>
        typeof props.enabled === "function" ? (props.enabled as () => boolean)() : props.enabled ?? true;

    const handle = runtime.store.registerScope({

        id: scopeId,
        parentId,
        priority: props.priority,
        getBindings: bindingsAccessor,
        isEnabled: enabledAccessor,
    });

    onCleanup(() => handle.dispose());

    return (
        <ParentScopeContext.Provider value={handle.id}>{props.children}</ParentScopeContext.Provider>
    );
}

function useKeymapRuntime(): KeymapRuntime {
    const ctx = useContext(KeymapRuntimeContext);
    if (!ctx) {
        throw new Error("KeymapProvider is missing in component tree");
    }
    return ctx;
}

function isBindingsAccessor(value: KeyBinding[] | Accessor<KeyBinding[]>): value is Accessor<KeyBinding[]> {
    return typeof value === "function";
}

export type { KeyBinding } from "@src/core/stores/keyScopes";
