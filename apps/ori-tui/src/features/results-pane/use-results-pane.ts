import type { QueryJob } from "@src/entities/query-job/providers/query-jobs-provider";
import type { PaneFocusController } from "@src/features/connection/view/pane-types";
import type { Accessor } from "solid-js";
import { createEffect, createSignal } from "solid-js";

export type ResultsPaneViewModel = {
  visible: Accessor<boolean>;
  isFocused: Accessor<boolean>;
  focusSelf: () => void;
  job: Accessor<QueryJob | undefined>;
  toggleVisible: () => void;
};

type UseResultsPaneOptions = {
  job: Accessor<QueryJob | undefined>;
  focus: PaneFocusController;
};

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
    if (job?.result || job?.error) {
      setVisible(true);
    }
  });

  return {
    visible,
    isFocused: options.focus.isFocused,
    focusSelf: options.focus.focusSelf,
    job: options.job,
    toggleVisible,
  };
}
