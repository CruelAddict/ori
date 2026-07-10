import type { QueryJob } from "@usecase/query/usecase"
import type { ResultSourcePage } from "@usecase/result-source/usecase"
import { Show } from "solid-js"
import type { StatuslineContext, StatuslinePlugin } from "../statusline-types"

const FIRST_PAGE = "󰘀"
const PREVIOUS_PAGE = ""
const NEXT_PAGE = ""
const LAST_PAGE = "󰘁"

export const resultPaginationPlugin: StatuslinePlugin = {
  visible: (ctx) => paginationForActiveResultsPane(ctx) !== undefined,
  render: (ctx) => <ResultPaginationView ctx={ctx} />,
}

function ResultPaginationView(props: { ctx: StatuslineContext }) {
  const pagination = () => paginationForActiveResultsPane(props.ctx)

  return (
    <Show when={pagination()}>
      {(current: () => ResultPagination) => (
        <>
          <props.ctx.Text color="text_muted">{FIRST_PAGE}</props.ctx.Text>
          <props.ctx.Text> </props.ctx.Text>
          <props.ctx.Text color="text_muted">{PREVIOUS_PAGE}</props.ctx.Text>
          <props.ctx.Text> </props.ctx.Text>
          <props.ctx.Text>{current().label}</props.ctx.Text>
          <props.ctx.Text> </props.ctx.Text>
          <props.ctx.Text color="text_muted">{NEXT_PAGE}</props.ctx.Text>
          <props.ctx.Text> </props.ctx.Text>
          <props.ctx.Text color="text_muted">{LAST_PAGE}</props.ctx.Text>
        </>
      )}
    </Show>
  )
}

function paginationForActiveResultsPane(ctx: StatuslineContext) {
  const view = ctx.app.activeResourceView()
  if (!view?.visiblePanes().results) {
    return undefined
  }
  return buildResultPagination(view.results.job(), view.results.pagination())
}

type ResultPagination = {
  label: string
}

function buildResultPagination(
  job: QueryJob | undefined,
  page: ResultSourcePage | undefined,
): ResultPagination | undefined {
  const result = job?.result
  if (job?.status !== "success" || !result || !page) {
    return undefined
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

  return {
    label: `${start}-${end} / ${total}`,
  }
}
