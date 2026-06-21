import { describe, expect, test } from "bun:test"
import type { QueryResultView } from "@adapters/ori/client"
import { ScrollBoxRenderable } from "@opentui/core"
import type { QueryJob } from "@usecase/query/usecase"
import { getSelectionOverrideText } from "@utils/clipboard"
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

function rowTokenFromCell(value: string, prefix: string) {
  if (!value.startsWith(prefix)) return null
  return value.slice(prefix.length)
}

function inconsistentVisibleRowReason(row: ParsedVisibleRow) {
  const leftToken = rowTokenFromCell(row.left, "LEFT-")
  const midToken = rowTokenFromCell(row.mid, "MID-")
  const viewToken = rowTokenFromCell(row.view, "VIEW-")
  const rightToken = rowTokenFromCell(row.right, "RIGHT-")

  if (!leftToken || !midToken || !viewToken || !rightToken) {
    return "column prefixes do not match expected row shape"
  }

  const tokens = new Set([leftToken, midToken, viewToken, rightToken])
  if (tokens.size !== 1) {
    return "visible row cells do not agree on the same row token"
  }

  return null
}

async function captureDragAutoscrollFrames(
  app: MountedTuiApp,
  scrollbox: ScrollBoxRenderable,
  options: {
    startScrollTop: number
    dragHoldY: number
    cycleCount: number
    framesPerCycle: number
  },
) {
  const dragX = scrollbox.viewport.x + 1
  const dragStartY = scrollbox.viewport.y + 2
  const capturedFrames = [] as CapturedRowFrame[]

  for (const cycle of Array.from({ length: options.cycleCount }, (_, index) => index)) {
    scrollbox.scrollTo({ x: 0, y: options.startScrollTop })
    await app.waitFor(() => (scrollbox.scrollTop ?? 0) === options.startScrollTop)

    await app.setup.mockMouse.pressDown(dragX, dragStartY)
    await app.setup.mockMouse.moveTo(dragX, options.dragHoldY)

    // Mock mouse drag does not kick off ScrollBox autoscroll in the test renderer,
    // so drive the same OpenTUI autoscroll primitive directly after a real selection start.
    scrollbox.startAutoScroll(dragX, options.dragHoldY)

    try {
      for (const frame of Array.from({ length: options.framesPerCycle }, (_, index) => index)) {
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
      await app.setup.mockMouse.release(dragX, options.dragHoldY)
      await app.waitFor(() => !app.setup.renderer.getSelection()?.isDragging)
    }
  }

  return capturedFrames
}

describe("results panel integration", () => {
  test("keeps table selection while dragging over the scrollbar edge", async () => {
    const app = await mountInTui(
      () => createComponent(ResultsPanel, { viewModel: createViewModel(createResultsJob(20)) }),
      { width: 48, height: 8 },
    )

    try {
      const scrollbox = getResultsScrollbox(app)
      const dragX = scrollbox.viewport.x + 2
      const dragStartY = scrollbox.viewport.y + 1
      const dragEndY = scrollbox.viewport.y + 3
      const scrollbarEdgeX = scrollbox.x + scrollbox.width - 1

      await app.setup.mockMouse.pressDown(dragX, dragStartY)
      await app.setup.mockMouse.moveTo(dragX, dragEndY)
      await app.waitFor(() => getSelectionOverrideText() !== undefined)
      await app.setup.mockMouse.moveTo(scrollbarEdgeX, dragEndY)
      await app.renderOnce()

      expect(app.setup.renderer.getSelection()?.isDragging).toBe(true)
      expect(getSelectionOverrideText()).not.toBeUndefined()

      await app.setup.mockMouse.release(scrollbarEdgeX, dragEndY)
      await app.waitFor(() => getSelectionOverrideText() === undefined)
    } finally {
      app.destroy()
    }
  })

  test("finishes table selection when mouse is released outside the table", async () => {
    const app = await mountInTui(
      () => (
        <box flexDirection="row">
          <box width={48}>
            <ResultsPanel viewModel={createViewModel(createResultsJob(20))} />
          </box>
          <box width={12}>
            <text>outside</text>
          </box>
        </box>
      ),
      { width: 60, height: 8 },
    )

    try {
      const scrollbox = getResultsScrollbox(app)
      const dragX = scrollbox.viewport.x + 2
      const dragStartY = scrollbox.viewport.y + 1
      const dragEndY = scrollbox.viewport.y + 3
      const outsideX = scrollbox.x + scrollbox.width + 4

      await app.setup.mockMouse.pressDown(dragX, dragStartY)
      await app.setup.mockMouse.moveTo(dragX, dragEndY)
      await app.waitFor(() => getSelectionOverrideText() !== undefined)
      await app.setup.mockMouse.release(outsideX, dragEndY)
      await app.waitFor(() => !app.setup.renderer.getSelection()?.isDragging)
      await app.waitFor(() => getSelectionOverrideText() === undefined)
    } finally {
      app.destroy()
    }
  })

  test("keeps visible rows internally consistent during upward drag autoscroll", async () => {
    const app = await mountInTui(
      () => createComponent(ResultsPanel, { viewModel: createViewModel(createResultsJob(80)) }),
      { width: 48, height: 8 },
    )

    try {
      const scrollbox = getResultsScrollbox(app)
      const capturedFrames = await captureDragAutoscrollFrames(app, scrollbox, {
        startScrollTop: 20,
        dragHoldY: scrollbox.y - 1,
        cycleCount: 12,
        framesPerCycle: 10,
      })

      const inconsistentFrames = capturedFrames.flatMap((item) => {
        const parsed = parseVisibleRow(item.line)
        if (!parsed) {
          return [{ ...item, reason: "could not parse visible row" }]
        }

        const reason = inconsistentVisibleRowReason(parsed)
        if (!reason) {
          return []
        }

        return [{ ...item, parsed, reason }]
      })

      expect(inconsistentFrames).toEqual([])
    } finally {
      app.destroy()
    }
  })

  test("keeps visible rows internally consistent during downward drag autoscroll", async () => {
    const app = await mountInTui(
      () => createComponent(ResultsPanel, { viewModel: createViewModel(createResultsJob(80)) }),
      { width: 48, height: 8 },
    )

    try {
      const scrollbox = getResultsScrollbox(app)
      const capturedFrames = await captureDragAutoscrollFrames(app, scrollbox, {
        startScrollTop: 0,
        dragHoldY: scrollbox.y + scrollbox.height + 1,
        cycleCount: 8,
        framesPerCycle: 10,
      })

      const inconsistentFrames = capturedFrames.flatMap((item) => {
        const parsed = parseVisibleRow(item.line)
        if (!parsed) {
          return [{ ...item, reason: "could not parse visible row" }]
        }

        const reason = inconsistentVisibleRowReason(parsed)
        if (reason) {
          return [{ ...item, parsed, reason }]
        }

        return []
      })

      expect(inconsistentFrames).toEqual([])
    } finally {
      app.destroy()
    }
  })
})
