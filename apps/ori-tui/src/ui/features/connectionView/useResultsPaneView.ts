import { createEffect, createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import type { PaneFocusController, PaneScopeModel } from "./paneTypes";
import type { QueryJob } from "@src/providers/queryJobs";

export interface ResultsPaneViewModel {
    scope: PaneScopeModel;
    visible: Accessor<boolean>;
    isFocused: Accessor<boolean>;
    job: Accessor<QueryJob | undefined>;
    toggleVisible: () => void;
}

interface UseResultsPaneOptions {
    job: Accessor<QueryJob | undefined>;
    focus: PaneFocusController;
}

export function useResultsPaneView(options: UseResultsPaneOptions): ResultsPaneViewModel {
    const [visible, setVisible] = createSignal(false);

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

    createEffect(() => {
        const job = options.job();
        if (job?.status === "success" && job.result) {
            setVisible(true);
        }
    });

    const scope: PaneScopeModel = {
        id: "connection-view.results",
        bindings: () => [],
        enabled: () => visible() && options.focus.isFocused(),
    };

    return {
        scope,
        visible,
        isFocused: options.focus.isFocused,
        job: options.job,
        toggleVisible,
    };
}
