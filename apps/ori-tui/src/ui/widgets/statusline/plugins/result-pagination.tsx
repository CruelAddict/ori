import { Show } from "solid-js"
import type { StatuslineContext, StatuslinePlugin } from "../statusline-types"
import { buildResultPagination } from "./result-pagination-model"

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
      {(current: () => string) => (
        <>
          <props.ctx.Text color="text_muted">{FIRST_PAGE}</props.ctx.Text>
          <props.ctx.Text> </props.ctx.Text>
          <props.ctx.Text color="text_muted">{PREVIOUS_PAGE}</props.ctx.Text>
          <props.ctx.Text> </props.ctx.Text>
          <props.ctx.Text>{current()}</props.ctx.Text>
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
  return buildResultPagination(view.results.job(), view.results.pagination(), view.results.isNavigating())
}
