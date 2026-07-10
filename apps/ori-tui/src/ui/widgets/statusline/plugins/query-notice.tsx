import type { HighlightGroup } from "@ui/theme"
import type { QueryJob } from "@usecase/query/usecase"
import { Show } from "solid-js"
import type { StatuslineContext, StatuslinePlugin } from "../statusline-types"

const STATUSLINE_NOTICE_TTL_MS = 3000

type QueryNotice = {
  message: string
  color: HighlightGroup
}

export const queryNoticePlugin: StatuslinePlugin = {
  visible: (ctx) => buildQueryNotice(ctx.app.activeResourceView()?.results.job(), ctx.now()) !== undefined,
  render: (ctx) => <QueryNoticeView ctx={ctx} />,
}

function QueryNoticeView(props: { ctx: StatuslineContext }) {
  const notice = () => buildQueryNotice(props.ctx.app.activeResourceView()?.results.job(), props.ctx.now())

  return (
    <Show when={notice()}>
      <props.ctx.Text color={notice()?.color}>•</props.ctx.Text>
      <props.ctx.Text> </props.ctx.Text>
      <props.ctx.Text color="text_muted">{notice()?.message}</props.ctx.Text>
    </Show>
  )
}

function buildQueryNotice(job: QueryJob | undefined, now: number): QueryNotice | undefined {
  if (!job || job.finishedAt === undefined) {
    return undefined
  }
  if (now - job.finishedAt >= STATUSLINE_NOTICE_TTL_MS) {
    return undefined
  }
  if (job.status === "success") {
    return createNotice(formatSuccessNotification(job), "success")
  }
  if (job.status === "failed") {
    return createNotice(job.error || job.message || "query failed", "error")
  }
  if (job.status === "canceled") {
    return createNotice("query canceled", "warning")
  }
  return undefined
}

function createNotice(message: string, color: HighlightGroup): QueryNotice {
  return { message, color }
}

function formatSuccessNotification(job: QueryJob) {
  const result = job.result
  const durationText = job.durationMs === undefined ? "" : ` in ${job.durationMs}ms`

  if (result && result.rows.length > 0) {
    const rowsText = `${result.rowCount} row${result.rowCount === 1 ? "" : "s"}`
    const truncatedText = result.truncated ? " (truncated)" : ""
    return `${rowsText}${truncatedText}${durationText}`
  }
  if (result?.rowsAffected !== undefined) {
    return `${result.rowsAffected} row${result.rowsAffected === 1 ? "" : "s"} affected${durationText}`
  }
  const fallbackDurationText = job.durationMs === undefined ? "" : ` (${job.durationMs}ms)`
  return `Query completed successfully${fallbackDurationText}`
}
