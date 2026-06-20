import { describe, expect, test } from "bun:test"
import { ScrollBoxRenderable } from "@opentui/core"
import type { QueryResultView } from "@adapters/ori/client"
import type { QueryJob } from "@usecase/query/usecase"
import { createComponent } from "solid-js"
import { type MountedTuiApp, mountInTui } from "../../../test/opentui-harness"
import { findRequiredNode, readFrameLines } from "../../../test/opentui-test-tools"
import { ResultsPanel } from "./results-panel"
import type { ResultsPaneViewModel } from "./view-model/create-vm"

type ParsedVisibleRow = {
  rowNumber: number
  left: string
  mid: string
  view: string
  right: string
}

type CapturedRowFrame = {
  cycle: number
  frame: number
  scrollTop: number
  lineIndex: number
  line: string
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function rowToken(rowNumber: number) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz"
  const first = alphabet[Math.floor(rowNumber / 26) % 26] ?? "a"
  const second = alphabet[rowNumber % 26] ?? "a"
  return `${first}${second}`
}

function createResultsJob(rowCount: number): QueryJob {
  const result = {
    columns: [
      { name: "LEFT", type: "text" },
      { name: "MID", type: "text" },
      { name: "VIEW", type: "text" },
      { name: "RIGHT", type: "text" },
    ],
    rows: Array.from({ length: rowCount }, (_, index) => {
      const token = rowToken(index + 1)
      return [`LEFT-${token}`, `MID-${token}`, `VIEW-${token}`, `RIGHT-${token}`]
    }),
    rowCount,
    truncated: false,
  } satisfies QueryResultView

  return {
    jobId: "results-panel-drag-scroll-repro",
    resourceName: "test",
    query: "select * from repro",
    status: "success",
    result,
  }
}

function createViewModel(job: QueryJob): ResultsPaneViewModel {
  return {
    isFocused: () => true,
    focusSelf: () => {},
    job: () => job,
  }
}

function getResultsScrollbox(app: MountedTuiApp) {
  return findRequiredNode(
    app,
    (node): node is ScrollBoxRenderable => node instanceof ScrollBoxRenderable,
    "Results scrollbox was not rendered",
  )
}

function parseVisibleRow(line: string): ParsedVisibleRow | null {
  const parts = line.split("│").map((part) => part.trim())
  if (parts.length < 5) return null

  const rowNumber = Number.parseInt(parts[0] ?? "", 10)
  if (!Number.isFinite(rowNumber)) return null

  return {
    rowNumber,
    left: parts[1] ?? "",
    mid: parts[2] ?? "",
    view: parts[3] ?? "",
    right: parts[4] ?? "",
  }
}

function expectedVisibleRow(rowNumber: number) {
  const token = rowToken(rowNumber)
  return {
    left: `LEFT-${token}`,
    mid: `MID-${token}`,
    view: `VIEW-${token}`,
    right: `RIGHT-${token}`,
  }
}

describe("results panel integration", () => {
  test("keeps the first visible row aligned while upward drag autoscroll is active", async () => {
      const app = await mountInTui(
        () => createComponent(ResultsPanel, { viewModel: createViewModel(createResultsJob(80)) }),
      { width: 48, height: 8 },
    )

    try {
      const scrollbox = getResultsScrollbox(app)
      const dragX = scrollbox.viewport.x + 1
      const dragStartY = scrollbox.viewport.y + 2
      const dragHoldY = scrollbox.y - 1

      const capturedFrames = [] as CapturedRowFrame[]
      const cycleCount = 12
      const framesPerCycle = 10

      for (const cycle of Array.from({ length: cycleCount }, (_, index) => index)) {
        scrollbox.scrollTo({ x: 0, y: 20 })
        await app.waitFor(() => (scrollbox.scrollTop ?? 0) === 20)

        await app.setup.mockMouse.pressDown(dragX, dragStartY)
        await app.setup.mockMouse.moveTo(dragX, dragHoldY)

        // Mock mouse drag does not kick off ScrollBox autoscroll in the test renderer,
        // so drive the same OpenTUI autoscroll primitive directly after a real selection start.
        scrollbox.startAutoScroll(dragX, dragHoldY)

        try {
          for (const frame of Array.from({ length: framesPerCycle }, (_, index) => index)) {
            await sleep(25)
            await app.renderOnce()
            capturedFrames.push({
              cycle,
              frame,
              scrollTop: scrollbox.scrollTop ?? 0,
              lineIndex: scrollbox.viewport.y,
              line: readFrameLines(app)[scrollbox.viewport.y] ?? "",
            })
          }
        } finally {
          await app.setup.mockMouse.release(dragX, dragHoldY)
          await app.waitFor(() => !app.setup.renderer.getSelection()?.isDragging)
        }
      }

      const glitches = capturedFrames.flatMap((item) => {
        const parsed = parseVisibleRow(item.line)
        if (!parsed) {
          return [{ ...item, reason: "could not parse visible row" }]
        }

        const expected = expectedVisibleRow(parsed.rowNumber)
        if (
          parsed.left === expected.left &&
          parsed.mid === expected.mid &&
          parsed.view === expected.view &&
          parsed.right === expected.right
        ) {
          return []
        }

        return [{ ...item, actual: parsed, expected }]
      })

      expect(glitches).toEqual([])
    } finally {
      app.destroy()
    }
  })
})
