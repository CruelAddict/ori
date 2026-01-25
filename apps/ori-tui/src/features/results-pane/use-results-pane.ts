import type { QueryJob } from "@src/entities/query-job/providers/query-jobs-provider"
import type { PaneFocusController } from "@src/features/connection/view/pane-types"
import type { Accessor } from "solid-js"

export type ResultsPaneViewModel = {
  visible: Accessor<boolean>
  isFocused: Accessor<boolean>
  focusSelf: () => void
  job: Accessor<QueryJob | undefined>
}

type UseResultsPaneOptions = {
  job: Accessor<QueryJob | undefined>
  focus: PaneFocusController
  isVisible: Accessor<boolean>
}

export function useResultsPane(options: UseResultsPaneOptions): ResultsPaneViewModel {
  return {
    visible: options.isVisible,
    isFocused: options.focus.isFocused,
    focusSelf: options.focus.focusSelf,
    job: options.job,
  }
}
