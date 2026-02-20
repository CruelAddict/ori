import type { QueryJob } from "@usecase/query/usecase"
import type { Accessor } from "solid-js"

export type ResultsPaneViewModel = {
  isFocused: Accessor<boolean>
  focusSelf: () => void
  job: Accessor<QueryJob | undefined>
}

type CreateVMOptions = {
  job: Accessor<QueryJob | undefined>
  isFocused: Accessor<boolean>
  focusSelf: () => void
}

export function createVM(options: CreateVMOptions): ResultsPaneViewModel {
  return {
    isFocused: options.isFocused,
    focusSelf: options.focusSelf,
    job: options.job,
  }
}
