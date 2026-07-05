import { describe, expect, test } from "bun:test"
import type { QueryJob } from "@usecase/query/usecase"
import { buildStatuslineModel, STATUSLINE_NOTICE_TTL_MS, type StatuslineItem } from "./statusline-model"

function itemText(items: StatuslineItem[]) {
  return items.map((item) => item.segments.map((segment) => segment.text).join(""))
}

function successJob(finishedAt: number): QueryJob {
  return {
    jobId: "job-1",
    resourceName: "warehouse",
    query: "select 1",
    status: "success",
    startedAt: finishedAt - 12,
    finishedAt,
    durationMs: 12,
    result: {
      columns: [{ name: "one", type: "int" }],
      rows: [[1]],
      rowCount: 1,
      truncated: false,
    },
  }
}

describe("statusline model", () => {
  test("keeps resource indicator and commands", () => {
    const model = buildStatuslineModel({ resource: { name: "warehouse" } }, 1000)

    expect(itemText(model.left)).toEqual(["• warehouse"])
    expect(itemText(model.right)).toEqual(["ctrl+p commands"])
  })

  test("shows query notice until ttl expires", () => {
    const finishedAt = 1000
    const visible = buildStatuslineModel(
      { resource: { name: "warehouse", queryJob: successJob(finishedAt) } },
      finishedAt + STATUSLINE_NOTICE_TTL_MS - 1,
    )
    const hidden = buildStatuslineModel(
      { resource: { name: "warehouse", queryJob: successJob(finishedAt) } },
      finishedAt + STATUSLINE_NOTICE_TTL_MS,
    )

    expect(itemText(visible.right)).toEqual(["ctrl+p commands", "• 1 row in 12ms"])
    expect(itemText(hidden.right)).toEqual(["ctrl+p commands"])
  })
})
