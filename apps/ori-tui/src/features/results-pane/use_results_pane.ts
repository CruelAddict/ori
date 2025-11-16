import { createEffect, createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import type { PaneFocusController } from "@src/features/connection/view/pane_types";
import type { QueryJob } from "@src/entities/query-job/providers/query_jobs_provider";

export interface ResultsPaneViewModel {
    visible: Accessor<boolean>;
    isFocused: Accessor<boolean>;
    job: Accessor<QueryJob | undefined>;
    toggleVisible: () => void;
}

interface UseResultsPaneOptions {
    job: Accessor<QueryJob | undefined>;
    focus: PaneFocusController;
}

export function useResultsPane(options: UseResultsPaneOptions): ResultsPaneViewModel {
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

    return {
        visible,
        isFocused: options.focus.isFocused,
        job: options.job,
        toggleVisible,
    };
}
