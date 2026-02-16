import type { QueryJob } from "@src/entities/query/providers/query-provider"
import type { Accessor } from "solid-js"

export type ResultsPaneViewModel = {
  isFocused: Accessor<boolean>
  focusSelf: () => void
  job: Accessor<QueryJob | undefined>
}

type CreateResultsPaneModelOptions = {
  job: Accessor<QueryJob | undefined>
  isFocused: Accessor<boolean>
  focusSelf: () => void
}

export function createResultsPaneModel(options: CreateResultsPaneModelOptions): ResultsPaneViewModel {
  return {
    isFocused: options.isFocused,
    focusSelf: options.focusSelf,
    job: options.job,
  }
}
