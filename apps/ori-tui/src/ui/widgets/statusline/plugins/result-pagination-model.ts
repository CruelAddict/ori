import type { QueryJob } from "@usecase/query/usecase"
import type { ResultSourcePage } from "@usecase/result-source/usecase"

export function buildResultPagination(
  job: QueryJob | undefined,
  page: ResultSourcePage | undefined,
  isNavigating: boolean,
): string | undefined {
  if (isNavigating && page) {
    return "loading..."
  }
  const result = job?.result
  if (job?.status !== "success" || !result || !page) {
    return undefined
  }
  if (page.offset > 0 && result.rows.length === 0 && !result.truncated) {
    return `- / ≤${page.offset}`
  }
  if (result.rows.length === 0) {
    return undefined
  }

  const hasMultiplePages = page.offset > 0 || result.truncated || page.totalRows > page.pageSize
  if (!hasMultiplePages) {
    return undefined
  }

  const start = page.offset + 1
  const end = page.offset + result.rows.length
  const total = `${page.totalRows}${page.isTotalRowsExact ? "" : "+"}`

  return `${start}-${end} / ${total}`
}
