import type { Accessor } from "solid-js";

export type PaneFocusController = {
    isFocused: Accessor<boolean>;
    focusSelf: () => void;
    focusFallback?: () => void;
};
