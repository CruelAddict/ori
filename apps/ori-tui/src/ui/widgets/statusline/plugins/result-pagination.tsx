import type { MouseEvent } from "@opentui/core"
import { createSignal, Show } from "solid-js"
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
  const view = () => props.ctx.app.activeResourceView()

  return (
    <Show when={pagination()}>
      {(current: () => string) => (
        <>
          <PaginationControl
            id="result-pagination-first"
            icon={FIRST_PAGE}
            enabled={() => view()?.results.canLoadFirstPage() ?? false}
            onClick={() => view()?.results.loadFirstPage()}
            ctx={props.ctx}
          />
          <props.ctx.Text> </props.ctx.Text>
          <PaginationControl
            id="result-pagination-previous"
            icon={PREVIOUS_PAGE}
            enabled={() => view()?.results.canLoadPreviousPage() ?? false}
            onClick={() => view()?.results.loadPreviousPage()}
            ctx={props.ctx}
          />
          <props.ctx.Text> </props.ctx.Text>
          <props.ctx.Text>{current()}</props.ctx.Text>
          <props.ctx.Text> </props.ctx.Text>
          <PaginationControl
            id="result-pagination-next"
            icon={NEXT_PAGE}
            enabled={() => view()?.results.canLoadNextPage() ?? false}
            onClick={() => view()?.results.loadNextPage()}
            ctx={props.ctx}
          />
          <props.ctx.Text> </props.ctx.Text>
          <PaginationControl
            id="result-pagination-last"
            icon={LAST_PAGE}
            enabled={() => view()?.results.canLoadLastPage() ?? false}
            onClick={() => view()?.results.loadLastPage()}
            ctx={props.ctx}
          />
        </>
      )}
    </Show>
  )
}

function PaginationControl(props: {
  id: string
  icon: string
  enabled: () => boolean
  onClick: () => void
  ctx: StatuslineContext
}) {
  const [hovered, setHovered] = createSignal(false)
  const handleMouseDown = (event: MouseEvent) => {
    if (!props.enabled()) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    props.onClick()
  }

  return (
    /* biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI uses box as the pointer target. */
    /* biome-ignore lint/a11y/useKeyWithMouseEvents: ResultsPanel registers equivalent pagination shortcuts. */
    <box
      id={props.id}
      onMouseDown={handleMouseDown}
      onMouseOver={() => props.enabled() && setHovered(true)}
      onMouseOut={() => setHovered(false)}
    >
      <props.ctx.Text color={hovered() && props.enabled() ? "primary" : "text_muted"}>{props.icon}</props.ctx.Text>
    </box>
  )
}

function paginationForActiveResultsPane(ctx: StatuslineContext) {
  const view = ctx.app.activeResourceView()
  if (!view?.visiblePanes().results) {
    return undefined
  }
  return buildResultPagination(view.results.job(), view.results.pagination(), view.results.isNavigating())
}
