import type { QueryJob } from "@usecase/query/usecase"

export const STATUSLINE_NOTICE_TTL_MS = 3000

export type StatuslineColor = "text" | "text_muted" | "success" | "warning" | "error"

export type StatuslineSegment = {
  text: string
  color: StatuslineColor
}

export type StatuslineItem = {
  segments: StatuslineSegment[]
}

export type StatuslineModel = {
  left: StatuslineItem[]
  right: StatuslineItem[]
}

export type StatuslineSnapshot = {
  resource?: {
    name: string
    queryJob?: QueryJob
  }
}

export function buildStatuslineModel(snapshot: StatuslineSnapshot, now: number): StatuslineModel {
  const left: StatuslineItem[] = snapshot.resource
    ? [
        {
          segments: [
            { text: "•", color: "success" },
            { text: " ", color: "text" },
            { text: snapshot.resource.name, color: "text" },
          ],
        },
      ]
    : []

  const right: StatuslineItem[] = [
    {
      segments: [
        { text: "ctrl+p", color: "text" },
        { text: " ", color: "text" },
        { text: "commands", color: "text_muted" },
      ],
    },
  ]

  const notice = buildQueryNotice(snapshot.resource?.queryJob, now)
  if (notice) {
    right.push(notice)
  }

  return { left, right }
}

function buildQueryNotice(job: QueryJob | undefined, now: number): StatuslineItem | undefined {
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

function createNotice(message: string, color: StatuslineColor): StatuslineItem {
  return {
    segments: [
      { text: "•", color },
      { text: " ", color: "text" },
      { text: message, color: "text_muted" },
    ],
  }
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
