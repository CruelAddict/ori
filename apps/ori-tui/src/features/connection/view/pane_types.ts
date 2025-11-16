import type { Accessor } from "solid-js";
import type { KeyBinding } from "@src/core/stores/keyScopes";

export interface PaneScopeModel {
    id: string;
    bindings: Accessor<KeyBinding[]>;
    enabled: () => boolean;
}

export interface PaneFocusController {
    isFocused: Accessor<boolean>;
    focusSelf: () => void;
    focusFallback?: () => void;
}
