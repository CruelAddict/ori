import { describe, expect, test } from "bun:test"
import { AppContextProvider, type AppResourceView, useAppContext } from "@ui/providers/app-context"
import type { QueryJob } from "@usecase/query/usecase"
import type { ResultSourcePage } from "@usecase/result-source/usecase"
import { createComponent, onCleanup } from "solid-js"
import { type MountedTuiApp, mountInTui } from "../../../../test/opentui-harness"
import { Statusline } from "../statusline"

const PREVIOUS_PAGE = ""
const NEXT_PAGE = ""
const LAST_PAGE = "󰘁"

type Calls = {
  first: number
  previous: number
  next: number
  last: number
}

function StatuslineTestApp(props: { view: AppResourceView }) {
  const app = useAppContext()
  const unregister = app.registerResourceView(props.view)
  onCleanup(unregister)
  return <Statusline />
}

function createJob(truncated: boolean): QueryJob {
  return {
    jobId: "job",
    resourceName: "test",
    query: "SELECT * FROM books",
    status: "success",
    startedAt: 0,
    result: {
      columns: [],
      rows: [["row"]],
      rowCount: 1,
      truncated,
    },
  }
}

function createView(
  page: ResultSourcePage,
  truncated: boolean,
  enabled: { first: boolean; previous: boolean; next: boolean; last: boolean },
  calls: Calls,
): AppResourceView {
  return {
    resourceName: () => "test",
    title: () => "test",
    isActive: () => true,
    focusedPane: () => "results",
    visiblePanes: () => ({ explorer: false, editor: false, results: true }),
    explorer: {
      isFocused: () => false,
      loading: () => false,
      error: () => null,
      mode: () => "tree",
      filter: () => "",
      selectedId: () => null,
    },
    editor: {
      isFocused: () => false,
      filePath: () => "",
      queryText: () => "",
    },
    results: {
      isFocused: () => true,
      job: () => createJob(truncated),
      pagination: () => page,
      isNavigating: () => false,
      canLoadFirstPage: () => enabled.first,
      canLoadPreviousPage: () => enabled.previous,
      canLoadNextPage: () => enabled.next,
      canLoadLastPage: () => enabled.last,
      loadFirstPage: () => {
        calls.first += 1
      },
      loadPreviousPage: () => {
        calls.previous += 1
      },
      loadNextPage: () => {
        calls.next += 1
      },
      loadLastPage: () => {
        calls.last += 1
      },
    },
  }
}

function getControl(app: MountedTuiApp, id: string) {
  const control = app.setup.renderer.root.findDescendantById(id)
  if (!control) {
    throw new Error(`Missing pagination control: ${id}`)
  }
  return control
}

function getIconColor(app: MountedTuiApp, icon: string) {
  const span = app.setup
    .captureSpans()
    .lines.flatMap((line) => line.spans)
    .find((candidate) => candidate.text.includes(icon))
  if (!span) {
    throw new Error(`Missing pagination icon: ${icon}`)
  }
  return span.fg
}

describe("result pagination statusline", () => {
  test("highlights and invokes available controls while disabled controls stay inert", async () => {
    const calls: Calls = { first: 0, previous: 0, next: 0, last: 0 }
    const app = await mountInTui(
      () =>
        createComponent(AppContextProvider, {
          get children() {
            return createComponent(StatuslineTestApp, {
              view: createView(
                { pageSize: 500, offset: 0, totalRows: 501, isTotalRowsExact: false },
                true,
                { first: false, previous: false, next: true, last: true },
                calls,
              ),
            })
          },
        }),
      { width: 100, height: 4 },
    )

    try {
      const next = getControl(app, "result-pagination-next")
      const muted = getIconColor(app, NEXT_PAGE)
      await app.setup.mockMouse.moveTo(next.screenX, next.screenY)
      await app.renderOnce()

      expect(getIconColor(app, NEXT_PAGE)).not.toEqual(muted)
      await app.setup.mockMouse.click(next.screenX, next.screenY)
      expect(calls.next).toBe(1)

      const previous = getControl(app, "result-pagination-previous")
      const disabled = getIconColor(app, PREVIOUS_PAGE)
      await app.setup.mockMouse.moveTo(previous.screenX, previous.screenY)
      await app.renderOnce()

      expect(getIconColor(app, PREVIOUS_PAGE)).toEqual(disabled)
      await app.setup.mockMouse.click(previous.screenX, previous.screenY)
      expect(calls.previous).toBe(0)
    } finally {
      app.destroy()
    }
  })

  test("does not highlight or invoke next and last controls on the final page", async () => {
    const calls: Calls = { first: 0, previous: 0, next: 0, last: 0 }
    const app = await mountInTui(
      () =>
        createComponent(AppContextProvider, {
          get children() {
            return createComponent(StatuslineTestApp, {
              view: createView(
                { pageSize: 500, offset: 500, totalRows: 501, isTotalRowsExact: true },
                false,
                { first: true, previous: true, next: false, last: false },
                calls,
              ),
            })
          },
        }),
      { width: 100, height: 4 },
    )

    try {
      const next = getControl(app, "result-pagination-next")
      const nextColor = getIconColor(app, NEXT_PAGE)
      await app.setup.mockMouse.moveTo(next.screenX, next.screenY)
      await app.renderOnce()

      expect(getIconColor(app, NEXT_PAGE)).toEqual(nextColor)
      await app.setup.mockMouse.click(next.screenX, next.screenY)
      expect(calls.next).toBe(0)

      const last = getControl(app, "result-pagination-last")
      const lastColor = getIconColor(app, LAST_PAGE)
      await app.setup.mockMouse.moveTo(last.screenX, last.screenY)
      await app.renderOnce()

      expect(getIconColor(app, LAST_PAGE)).toEqual(lastColor)
      await app.setup.mockMouse.click(last.screenX, last.screenY)
      expect(calls.last).toBe(0)
    } finally {
      app.destroy()
    }
  })
})
