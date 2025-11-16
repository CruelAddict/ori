import type { Accessor } from "solid-js";

export interface PaneFocusController {
    isFocused: Accessor<boolean>;
    focusSelf: () => void;
    focusFallback?: () => void;
}
