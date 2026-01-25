import type { QueryJob } from "@src/entities/query-job/providers/query-jobs-provider"
import type { Accessor } from "solid-js"

export type ResultsPaneViewModel = {
  isFocused: Accessor<boolean>
  focusSelf: () => void
  job: Accessor<QueryJob | undefined>
}

type UseResultsPaneOptions = {
  job: Accessor<QueryJob | undefined>
  isFocused: Accessor<boolean>
  focusSelf: () => void
}

export function useResultsPane(options: UseResultsPaneOptions): ResultsPaneViewModel {
  return {
    isFocused: options.isFocused,
    focusSelf: options.focusSelf,
    job: options.job,
  }
}
