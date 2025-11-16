import { createMemo, createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import type { KeyBinding } from "@src/core/stores/keyScopes";
import { useGraphSnapshot } from "@src/lib/useGraphSnapshot";
import { useSchemaTree, type SchemaTreeController } from "@src/lib/schemaTree";
import type { PaneFocusController, PaneScopeModel } from "./paneTypes";

export interface TreePaneViewModel {
    scope: PaneScopeModel;
    controller: SchemaTreeController;
    visible: Accessor<boolean>;
    isFocused: Accessor<boolean>;
    loading: Accessor<boolean>;
    error: Accessor<string | null>;
    toggleVisible: () => void;
    refreshGraph: () => Promise<void>;
}

interface UseTreePaneOptions {
    configurationName: Accessor<string>;
    focus: PaneFocusController;
}

export function useTreePaneView(options: UseTreePaneOptions): TreePaneViewModel {
    const { snapshot, loading, error, refresh } = useGraphSnapshot(options.configurationName);
    const controller = useSchemaTree(snapshot);
    const [visible, setVisible] = createSignal(true);

    const toggleVisible = () => {
        setVisible((prev) => {
            const next = !prev;
            if (next) {
                options.focus.focusSelf();
            } else if (options.focus.isFocused() && options.focus.focusFallback) {
                options.focus.focusFallback();
            }
            return next;
        });
    };

    const moveSelection = (delta: number) => {
        controller.moveSelection(delta);
    };

    const handleTreeDown = () => moveSelection(1);
    const handleTreeUp = () => moveSelection(-1);

    const handleTreeRight = () => {
        controller.focusFirstChild();
    };

    const handleTreeLeft = () => {
        controller.collapseCurrentOrParent();
    };

    const bindings = createMemo<KeyBinding[]>(() => [
        {
            pattern: "down",
            handler: handleTreeDown,
            preventDefault: true,
        },
        {
            pattern: "j",
            handler: handleTreeDown,
            preventDefault: true,
        },
        {
            pattern: "up",
            handler: handleTreeUp,
            preventDefault: true,
        },
        {
            pattern: "k",
            handler: handleTreeUp,
            preventDefault: true,
        },
        {
            pattern: "right",
            handler: handleTreeRight,
            preventDefault: true,
        },
        {
            pattern: "l",
            handler: handleTreeRight,
            preventDefault: true,
        },
        {
            pattern: "left",
            handler: handleTreeLeft,
            preventDefault: true,
        },
        {
            pattern: "h",
            handler: handleTreeLeft,
            preventDefault: true,
        },
    ]);

    const scope: PaneScopeModel = {
        id: "connection-view.tree",
        bindings,
        enabled: () => visible() && options.focus.isFocused(),
    };

    return {
        scope,
        controller,
        visible,
        isFocused: options.focus.isFocused,
        loading,
        error,
        toggleVisible,
        refreshGraph: refresh,
    };
}
