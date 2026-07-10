import type { QueryJob } from "@usecase/query/usecase"
import type { ResultSourceUsecase } from "@usecase/result-source/usecase"
import type { Accessor } from "solid-js"
import { createMemo, createSignal, onCleanup } from "solid-js"

type CreateVMOptions = {
  job: Accessor<QueryJob | undefined>
  isFocused: Accessor<boolean>
  focusSelf: () => void
  resultSource: Pick<
    ResultSourceUsecase,
    "getState" | "subscribe" | "loadFirstPage" | "loadPreviousPage" | "loadNextPage" | "loadLastPage"
  >
}

export function createVM(options: CreateVMOptions) {
  const [resultSourceState, setResultSourceState] = createSignal(options.resultSource.getState())
  const unsubscribe = options.resultSource.subscribe(() => {
    setResultSourceState(options.resultSource.getState())
  })

  onCleanup(() => {
    unsubscribe()
  })

  return {
    isFocused: options.isFocused,
    focusSelf: options.focusSelf,
    job: options.job,
    pagination: createMemo(() => resultSourceState().current?.pagination),
    loadFirstPage: options.resultSource.loadFirstPage,
    loadPreviousPage: options.resultSource.loadPreviousPage,
    loadNextPage: options.resultSource.loadNextPage,
    loadLastPage: options.resultSource.loadLastPage,
  }
}

export type ResultsPaneViewModel = ReturnType<typeof createVM>
