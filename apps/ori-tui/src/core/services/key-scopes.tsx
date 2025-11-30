import type { KeyEvent } from "@opentui/core";
import { useKeyboard } from "@opentui/solid";
import { Keybind, type KeyboardEventLike, type ParsedKeybind, useKeybind } from "@shared/lib/keybind";
import { type KeyBinding, KeyScopeStore } from "@src/core/stores/key-scopes";
import type { Accessor, JSX, ParentComponent } from "solid-js";
import { createContext, createUniqueId, onCleanup, useContext } from "solid-js";

type KeymapRuntime = {
    store: KeyScopeStore;
};

type ParentScopeContextValue = {
    id: string | null;
    layer: number;
};

type DispatchTargetScopes = ReturnType<KeyScopeStore["getDispatchPlan"]>["primary"];

const KeymapRuntimeContext = createContext<KeymapRuntime>();
const ParentScopeContext = createContext<ParentScopeContextValue>({ id: null, layer: 0 });

export type KeymapProviderProps = {
    children: JSX.Element;
};

export const KeymapProvider: ParentComponent<KeymapProviderProps> = (props) => {
    const store = new KeyScopeStore();
    const parser = useKeybind();

    useKeyboard(createKeyboardHandler(store, parser));

    const runtime: KeymapRuntime = { store };

    return (
        <KeymapRuntimeContext.Provider value={runtime}>
            <ParentScopeContext.Provider value={{ id: null, layer: 0 }}>{props.children}</ParentScopeContext.Provider>
        </KeymapRuntimeContext.Provider>
    );
};

export type KeyScopeProps = {
    id?: string;
    bindings: KeyBinding[] | Accessor<KeyBinding[]>;
    enabled?: boolean | (() => boolean);
    priority?: number;
    layer?: number;
    children?: JSX.Element;
};

export function KeyScope(props: KeyScopeProps) {
    const runtime = useKeymapRuntime();
    const parent = useContext(ParentScopeContext);
    const parentId = parent.id;
    const inheritedLayer = parent.layer;
    const scopeId = props.id ?? createUniqueId();
    const bindingsProp = props.bindings;

    const bindingsAccessor: Accessor<KeyBinding[]> = isBindingsAccessor(bindingsProp)
        ? bindingsProp
        : () => bindingsProp;
    const enabledAccessor = () =>
        typeof props.enabled === "function" ? (props.enabled as () => boolean)() : (props.enabled ?? true);
    const layer = props.layer ?? inheritedLayer ?? 0;

    const handle = runtime.store.registerScope({
        id: scopeId,
        parentId,
        priority: props.priority,
        layer,
        getBindings: bindingsAccessor,
        isEnabled: enabledAccessor,
    });

    onCleanup(() => handle.dispose());

    return <ParentScopeContext.Provider value={{ id: handle.id, layer }}>{props.children}</ParentScopeContext.Provider>;
}

type DispatchScopesInput = {
    scopes: DispatchTargetScopes;
    parsed: ParsedKeybind;
    mode: "normal" | "leader";
    evt: KeyEvent;
    awaitingLeader: boolean;
};

function createKeyboardHandler(store: KeyScopeStore, parser: ReturnType<typeof useKeybind>): (evt: KeyEvent) => void {
    let awaitingLeader = false;

    return (evt: KeyEvent) => {
        const parsed = parser.parse(evt as KeyboardEventLike);
        if (shouldAwaitLeader(parsed, awaitingLeader)) {
            awaitingLeader = true;
            evt.preventDefault?.();
            return;
        }

        const mode: "normal" | "leader" = awaitingLeader ? "leader" : "normal";
        const plan = store.getDispatchPlan();

        if (dispatchScopes({ scopes: plan.primary, parsed, mode, evt, awaitingLeader })) {
            awaitingLeader = false;
            return;
        }

        if (dispatchScopes({ scopes: plan.system, parsed, mode, evt, awaitingLeader })) {
            awaitingLeader = false;
            return;
        }

        if (awaitingLeader) {
            evt.preventDefault?.();
            awaitingLeader = false;
        }
    };
}

function dispatchScopes({ scopes, parsed, mode, evt, awaitingLeader }: DispatchScopesInput): boolean {
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
            return true;
        }
    }
    return false;
}

function shouldAwaitLeader(parsed: ParsedKeybind, awaitingLeader: boolean): boolean {
    return !awaitingLeader && parsed.ctrl && parsed.name === "x";
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

export type { KeyBinding } from "@src/core/stores/key-scopes";
export { SYSTEM_LAYER } from "@src/core/stores/key-scopes";
