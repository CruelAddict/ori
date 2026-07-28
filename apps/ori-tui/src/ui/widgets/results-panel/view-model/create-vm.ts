import type { QueryJob } from "@usecase/query/usecase"
import type { ResultSourcePage, ResultSourceUsecase } from "@usecase/result-source/usecase"
import type { Accessor } from "solid-js"
import { createMemo } from "solid-js"

type CreateVMOptions = {
  job: Accessor<QueryJob | undefined>
  pagination: Accessor<ResultSourcePage | undefined>
  isNavigating: Accessor<boolean>
  isFocused: Accessor<boolean>
  focusSelf: () => void
  resultSource: Pick<ResultSourceUsecase, "loadFirstPage" | "loadPreviousPage" | "loadNextPage" | "loadLastPage">
}

export function createVM(options: CreateVMOptions) {
  const isIdle = () => !options.isNavigating() && options.job()?.status !== "running"
  const canMove = createMemo(() => isIdle() && (options.pagination()?.offset ?? 0) > 0)
  const canMoveNext = createMemo(() => {
    const job = options.job()
    const page = options.pagination()
    if (!isIdle() || job?.status !== "success" || !job.result || !page) {
      return false
    }
    const nextOffset = page.offset + page.pageSize
    return job.result.truncated && (!page.isTotalRowsExact || nextOffset < page.totalRows)
  })
  const canMoveLast = createMemo(() => {
    const page = options.pagination()
    if (!isIdle() || !page) {
      return false
    }
    return !page.isTotalRowsExact || page.offset + page.pageSize < page.totalRows
  })

  return {
    isFocused: options.isFocused,
    focusSelf: options.focusSelf,
    job: options.job,
    pagination: options.pagination,
    isNavigating: options.isNavigating,
    canLoadFirstPage: canMove,
    canLoadPreviousPage: canMove,
    canLoadNextPage: canMoveNext,
    canLoadLastPage: canMoveLast,
    loadFirstPage: options.resultSource.loadFirstPage,
    loadPreviousPage: options.resultSource.loadPreviousPage,
    loadNextPage: options.resultSource.loadNextPage,
    loadLastPage: options.resultSource.loadLastPage,
  }
}

export type ResultsPaneViewModel = ReturnType<typeof createVM>
