import { describe, expect, test } from "bun:test"
import {
  LineNumberRenderable,
  type MouseEvent,
  type ScrollBoxRenderable,
  SyntaxStyle,
  type TextareaRenderable,
} from "@opentui/core"
import type { MountedTuiApp } from "../../../test/opentui-harness"
import { findRequiredNode, readFrameLines, readFrameLineTokens } from "../../../test/opentui-test-tools"
import type { BufferAnalysis, BufferAnalysisRange } from "./analysis"
import type { BufferState } from "./buffer"
import { getBufferScrollbox, getBufferTextarea, mountBuffer, moveCursor } from "./buffer.test-tools"
import { docCharOffset, lineIndex } from "./coords"

type HighlightState = {
  plainText: string
  cursorOffset: number
  lineCount: number
  highlightedLines: number[]
  highlightCounts: Record<number, number>
}

type CursorState = {
  cursorOffset: number
  cursorLogicalRow: number
  cursorVisualRow: number
  editorScrollY: number
  scrollboxTop: number
  contextOffset?: number
  focusedRow?: number
}

type ScrollState = {
  cursorOffset: number
  cursorLogicalRow: number
  cursorVisualRow: number
  editorHeight: number
  editorScrollY: number
  scrollboxTop: number
  scrollHeight: number
  thumbVisible: boolean
  totalVirtualLineCount: number
  textareaWidth: number
}

function getHighlightedLines(textarea: TextareaRenderable, limit = 8) {
  const lines = [] as number[]
  const max = Math.min(limit, textarea.lineCount)
  for (let i = 0; i < max; i += 1) {
    if (textarea.getLineHighlights(i).length > 0) {
      lines.push(i)
    }
  }
  return lines
}

function captureHighlightState(textarea: TextareaRenderable, lines: number[]) {
  const counts = {} as Record<number, number>
  for (const line of lines) {
    counts[line] = textarea.getLineHighlights(line).length
  }

  return {
    plainText: textarea.plainText,
    cursorOffset: textarea.cursorOffset,
    lineCount: textarea.lineCount,
    highlightedLines: getHighlightedLines(textarea),
    highlightCounts: counts,
  } satisfies HighlightState
}

function expectHighlightedLines(state: HighlightState, lines: number[]) {
  // These are visible document line indexes that should currently have at least one syntax span.
  expect(state.highlightedLines).toEqual(lines)
  for (const line of lines) {
    expect(state.highlightCounts[line]).toBeGreaterThan(0)
  }
}

function hasHighlightedLines(textarea: TextareaRenderable, lines: number[]) {
  return getHighlightedLines(textarea).join(",") === lines.join(",")
}

function stripRenderedLineNumberPrefix(text: string) {
  const withoutIndent = text.trimStart()
  const firstSpace = withoutIndent.indexOf(" ")
  if (firstSpace <= 0) {
    return withoutIndent
  }

  const prefix = withoutIndent.slice(0, firstSpace)
  const isLineNumber = [...prefix].every((char) => char >= "0" && char <= "9")
  if (!isLineNumber) {
    return withoutIndent
  }

  // captureSpans includes the gutter prefix like "12 "; strip it before
  // asserting on the wrapped editor text itself.
  return withoutIndent.slice(firstSpace + 1)
}

function readVisibleLines(app: MountedTuiApp) {
  return readFrameLines(app)
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.trim().length > 0)
    .map(stripRenderedLineNumberPrefix)
}

function waitForImmediate() {
  return new Promise<void>((resolve) => setImmediate(resolve))
}

function getStateCursorOffset(state: BufferState | undefined) {
  return state?.cursor?.offset
}

function getStateCursorLine(state: BufferState | undefined) {
  return state?.cursor?.line
}

function busyWait(ms: number) {
  const started = performance.now()
  let elapsed = 0
  while (elapsed < ms) {
    elapsed = performance.now() - started
  }
}

function createBlockingAnalysis(syncMs: number): BufferAnalysis {
  const syntaxStyle = SyntaxStyle.create()
  return {
    syntaxStyle: () => {
      busyWait(syncMs)
      return syntaxStyle
    },
    collectRanges: (text, lineStarts) => [
      {
        start: docCharOffset(0),
        end: docCharOffset(text.length),
        startLine: lineIndex(0),
        endLine: lineIndex(Math.max(0, lineStarts.length - 1)),
      },
    ],
    highlightText: () => Promise.resolve([]),
  }
}

function createLineHighlightAnalysis(): BufferAnalysis {
  const syntaxStyle = SyntaxStyle.create()
  return {
    syntaxStyle: () => syntaxStyle,
    collectRanges: (text, lineStarts) => {
      const ranges = [] as BufferAnalysisRange[]
      for (let index = 0; index < lineStarts.length; index += 1) {
        const start = lineStarts[index] ?? docCharOffset(0)
        const nextStart = lineStarts[index + 1] ?? docCharOffset(text.length)
        const end = docCharOffset(index + 1 < lineStarts.length ? Math.max(start, nextStart - 1) : text.length)
        if (end <= start) {
          continue
        }

        ranges.push({
          start,
          end,
          startLine: lineIndex(index),
          endLine: lineIndex(index),
        })
      }
      return ranges
    },
    highlightText: (text) => Promise.resolve(text.length > 0 ? [{ start: 0, end: text.length, styleId: 1 }] : []),
  }
}

function createRawScrollSequence(x: number, y: number) {
  return `\u001b[<65;${x + 1};${y + 1}M`
}

function createWrappedScrollLockFixture() {
  const fillerCount = 560
  const blob = "151C2F00020000000D00"
  const longLine = `INSERT "Categories"("CategoryID","CategoryName","Description","Picture") VALUES(1,'Beverages','Soft drinks, coffees, teas, beers, and ales',0x${blob.repeat(90)})`
  const tail = Array.from({ length: 10 }, (_, i) => `tail-${i}`)

  return {
    text: `${Array.from({ length: fillerCount }, (_, i) => `line-${i}`).join("\n")}\n${longLine}\n${tail.join("\n")}`,
    longLineRow: fillerCount,
    tail,
  }
}

function getBufferLineNumber(app: MountedTuiApp) {
  return findRequiredNode(
    app,
    (node): node is LineNumberRenderable => node instanceof LineNumberRenderable,
    "Buffer line number was not rendered",
  )
}

function captureCursorState(
  textarea: TextareaRenderable,
  scrollbox: ScrollBoxRenderable,
  latestState: BufferState | undefined,
) {
  return {
    cursorOffset: textarea.cursorOffset,
    cursorLogicalRow: textarea.logicalCursor.row,
    cursorVisualRow: textarea.visualCursor.visualRow,
    editorScrollY: textarea.scrollY,
    scrollboxTop: scrollbox.scrollTop ?? 0,
    contextOffset: getStateCursorOffset(latestState),
    focusedRow: getStateCursorLine(latestState),
  } satisfies CursorState
}

function expectCursorContextSync(state: CursorState) {
  expect(state.contextOffset).toBe(state.cursorOffset)
  expect(state.focusedRow).toBe(state.cursorLogicalRow)
}

function captureScrollState(textarea: TextareaRenderable, scrollbox: ScrollBoxRenderable) {
  return {
    cursorOffset: textarea.cursorOffset,
    cursorLogicalRow: textarea.logicalCursor.row,
    cursorVisualRow: textarea.visualCursor.visualRow,
    editorHeight: textarea.height,
    editorScrollY: textarea.scrollY,
    scrollboxTop: scrollbox.scrollTop ?? 0,
    scrollHeight: scrollbox.scrollHeight,
    thumbVisible: scrollbox.verticalScrollBar.visible,
    totalVirtualLineCount: textarea.editorView.getTotalVirtualLineCount(),
    textareaWidth: textarea.width,
  } satisfies ScrollState
}

function expectScrollStateAligned(state: ScrollState) {
  expect(state.editorScrollY).toBe(state.scrollboxTop)
  expect(state.scrollHeight).toBeGreaterThanOrEqual(state.totalVirtualLineCount)
  expect(state.cursorVisualRow).toBeGreaterThanOrEqual(0)
  expect(state.cursorVisualRow).toBeLessThan(state.editorHeight)
  expect(state.cursorLogicalRow).toBe(state.cursorOffset)
}

describe("buffer integration", () => {
  test("renders visible statement highlights on mount and keeps them through local edits", async () => {
    const sql =
      "select * from authors;\nselect * from books limit 10;\nselect * from authors a\njoin books b on a.id = b.author_id\n"
    const visibleStatementLines = [0, 1, 2, 3]
    const app = await mountBuffer({ text: sql, width: 80, height: 20 })

    try {
      const textarea = getBufferTextarea(app)

      await app.waitFor(() => hasHighlightedLines(textarea, visibleStatementLines))
      const stateAfterInitialHighlight = captureHighlightState(textarea, visibleStatementLines)

      expect(stateAfterInitialHighlight.plainText).toBe(sql)
      expect(stateAfterInitialHighlight.cursorOffset).toBe(0)
      expect(stateAfterInitialHighlight.lineCount).toBe(5)
      expectHighlightedLines(stateAfterInitialHighlight, visibleStatementLines)

      await app.setup.mockInput.typeText("a")
      // Typing at the start of the first statement should update the text,
      // but keep the same visible lines highlighted while the statement is reprocessed.
      await app.waitFor(() => textarea.plainText === `a${sql}`)
      await app.waitFor(() => hasHighlightedLines(textarea, visibleStatementLines))
      const stateAfterType = captureHighlightState(textarea, visibleStatementLines)

      expect(stateAfterType.plainText).toBe(`a${sql}`)
      expect(stateAfterType.cursorOffset).toBe(1)
      expectHighlightedLines(stateAfterType, visibleStatementLines)

      app.setup.mockInput.pressBackspace()
      await app.waitFor(() => textarea.plainText === sql)
      await app.waitFor(() => hasHighlightedLines(textarea, visibleStatementLines))
      const stateAfterBackspace = captureHighlightState(textarea, visibleStatementLines)

      expect(stateAfterBackspace.plainText).toBe(sql)
      expect(stateAfterBackspace.cursorOffset).toBe(0)
      expectHighlightedLines(stateAfterBackspace, visibleStatementLines)
    } finally {
      app.destroy()
    }
  })

  test("renders full keyword spans after a leading tab", async () => {
    const keywordLineIndex = 2
    const sql = `if exists (select * from sysobjects where id = object_id('dbo.Employee Sales by Country') and sysstat & 0xf = 4)
	drop procedure "dbo"."Employee Sales by Country"
GO`
    const app = await mountBuffer({ text: sql, width: 120, height: 12 })

    try {
      await app.waitFor(() => readFrameLineTokens(app, keywordLineIndex).includes("procedure"))
      const lineTokens = readFrameLineTokens(app, keywordLineIndex)

      // The keyword should stay intact even after the leading tab shifts display columns.
      expect(lineTokens).toContain("drop")
      expect(lineTokens).toContain("procedure")
      expect(lineTokens).not.toContain("dro")
      expect(lineTokens).not.toContain(" procedur")
    } finally {
      app.destroy()
    }
  })

  test("keeps wrapped tail text visible instead of clipping it under the gutter", async () => {
    const line = "/* CHECK FOR DATABASE IF IT DOESN'T EXISTS, DO NOT RUN THE REST OF THE SCRIPT */"
    const app = await mountBuffer({ text: `${line}\n`, width: 78, height: 8 })

    try {
      await app.waitFor(() => readVisibleLines(app).length > 0)
      const visibleLines = readVisibleLines(app)

      // The wrapped tail should keep the full trailing fragment visible.
      expect(visibleLines).toContain("IPT */")
      // A clipped tail would leave only the very end of the token visible.
      expect(visibleLines).not.toContain("*/")
      expect(visibleLines).not.toContain("/")
    } finally {
      app.destroy()
    }
  })

  test("bounds multiline block comment highlights before following SQL", async () => {
    const lines = [
      "/*",
      "** Copyright Microsoft, Inc. 1994 - 2000",
      "** All Rights Reserved.",
      "*/",
      "",
      "-- This script does not create a database.",
      "SET NOCOUNT ON",
      "GO",
      "go",
      "",
      "/* Set DATEFORMAT so that the date strings are interpreted correctly regardless of",
      "   the default DATEFORMAT on the server.",
      "*/",
      "SET DATEFORMAT mdy",
      "GO",
      "go",
      "if exists (select 1)",
      "select 2",
    ]
    const sql = lines.join("\n")
    const app = await mountBuffer({ text: sql, width: 120, height: 12 })

    try {
      const textarea = getBufferTextarea(app)
      const hasStyle = (line: number, styleId: number | undefined) =>
        textarea.getLineHighlights(line).some((highlight) => highlight.styleId === styleId)

      await app.waitFor(() => textarea.getLineHighlights(0).length > 0 && textarea.getLineHighlights(13).length > 0)
      const commentStyleId = textarea.getLineHighlights(0)[0]?.styleId

      expect(commentStyleId).toBeDefined()
      expect(hasStyle(0, commentStyleId)).toBe(true)
      expect(hasStyle(10, commentStyleId)).toBe(true)
      expect(hasStyle(6, commentStyleId)).toBe(false)
      expect(hasStyle(7, commentStyleId)).toBe(false)
      expect(hasStyle(8, commentStyleId)).toBe(false)
      expect(hasStyle(13, commentStyleId)).toBe(false)
      expect(hasStyle(14, commentStyleId)).toBe(false)
      expect(hasStyle(15, commentStyleId)).toBe(false)
      expect(hasStyle(16, commentStyleId)).toBe(false)
    } finally {
      app.destroy()
    }
  })

  test("keeps buffer context aligned with OpenTUI cursor after mouse clicks", async () => {
    const text = `${Array.from({ length: 20 }, (_, i) => `line-${i}`).join("\n")}\n`
    const clickColumnOffset = 2
    const initialClickRowOffset = 2
    const scrolledClickRowOffset = 1
    const arrowDownPresses = 12
    let latestState: BufferState | undefined
    const app = await mountBuffer({
      text,
      width: 30,
      height: 8,
      onStateChange: (state) => {
        latestState = state
      },
    })

    try {
      const textarea = getBufferTextarea(app)
      const scrollbox = getBufferScrollbox(app)

      await app.waitFor(() => getStateCursorOffset(latestState) === 0)

      await app.setup.mockMouse.click(textarea.x + clickColumnOffset, textarea.y + initialClickRowOffset)
      await app.waitFor(() => (getStateCursorOffset(latestState) ?? -1) === textarea.cursorOffset)
      const stateAfterClick = captureCursorState(textarea, scrollbox, latestState)

      expectCursorContextSync(stateAfterClick)

      for (let i = 0; i < arrowDownPresses; i += 1) {
        app.setup.mockInput.pressArrow("down")
      }
      await app.waitFor(() => (scrollbox.scrollTop ?? 0) > 0)
      await app.waitFor(() => (getStateCursorOffset(latestState) ?? -1) === textarea.cursorOffset)
      const stateAfterKeyScroll = captureCursorState(textarea, scrollbox, latestState)

      expect(stateAfterKeyScroll.editorScrollY).toBe(stateAfterKeyScroll.scrollboxTop)
      expectCursorContextSync(stateAfterKeyScroll)

      await app.setup.mockMouse.click(textarea.x + clickColumnOffset, textarea.y + scrolledClickRowOffset)
      await app.waitFor(() => textarea.visualCursor.visualRow === 1)
      await app.waitFor(() => (getStateCursorOffset(latestState) ?? -1) === textarea.cursorOffset)
      const stateAfterScrolledClick = captureCursorState(textarea, scrollbox, latestState)

      expect(stateAfterScrolledClick.editorScrollY).toBe(stateAfterScrolledClick.scrollboxTop)
      expect(stateAfterScrolledClick.cursorVisualRow).toBe(1)
      expectCursorContextSync(stateAfterScrolledClick)
    } finally {
      app.destroy()
    }
  })

  test("keeps drag selection near the current viewport when released above the buffer", async () => {
    const text = `${Array.from({ length: 200 }, (_, i) => `line-${i}`).join("\n")}\n`
    const app = await mountBuffer({ text, width: 40, height: 8 })

    try {
      const textarea = getBufferTextarea(app)
      const scrollbox = getBufferScrollbox(app)

      await moveCursor(app, textarea, 120, 0)
      await app.waitFor(() => textarea.scrollY > 0)

      await app.setup.mockMouse.pressDown(textarea.x + 1, textarea.y + 4)
      await app.setup.mockMouse.moveTo(textarea.x + 8, textarea.y - 1)
      await app.renderOnce()
      await app.setup.mockMouse.release(textarea.x + 8, textarea.y - 1)
      await app.waitFor(() => app.setup.renderer.getSelection()?.isDragging === false)

      expect(textarea.showCursor).toBe(true)
      expect(textarea.logicalCursor.row).toBeGreaterThan(0)
      expect(textarea.scrollY).toBeGreaterThan(0)
      expect(textarea.scrollY).toBe(scrollbox.scrollTop)
      const scrollTopAfterRelease = scrollbox.scrollTop ?? 0

      scrollbox.startAutoScroll(scrollbox.x + 1, scrollbox.y - 1)
      expect(scrollbox.live).toBe(true)
      await app.waitFor(() => scrollbox.live === false, 500)

      expect(scrollbox.content.translateY).toBe(0)
      expect(scrollbox.scrollTop ?? 0).toBe(scrollTopAfterRelease)
      expect(readVisibleLines(app).length).toBeGreaterThan(0)
    } finally {
      app.destroy()
    }
  })

  test("scrolls upward while drag selection is held near the top edge", async () => {
    const text = `${Array.from({ length: 200 }, (_, i) => `line-${i}`).join("\n")}\n`
    const app = await mountBuffer({ text, width: 40, height: 8 })

    try {
      const textarea = getBufferTextarea(app)
      const scrollbox = getBufferScrollbox(app)

      await moveCursor(app, textarea, 120, 0)
      await app.waitFor(() => textarea.scrollY > 0)
      const topBeforeDrag = textarea.scrollY
      const liveBeforeDrag = textarea.live
      const scrollSpeedBeforeDrag = textarea.scrollSpeed

      await app.setup.mockMouse.pressDown(textarea.x + 1, textarea.y + 5)
      await app.setup.mockMouse.moveTo(textarea.x + 1, textarea.y)
      await app.waitFor(() => textarea.scrollY < topBeforeDrag)

      expect(textarea.showCursor).toBe(false)
      expect(textarea.live).toBe(true)
      expect(textarea.scrollSpeed).toBe(scrollSpeedBeforeDrag)
      expect(textarea.scrollY).toBe(scrollbox.scrollTop)

      await app.setup.mockMouse.moveTo(textarea.x + 1, textarea.y - 2)
      await app.renderOnce()
      expect(textarea.scrollSpeed).toBeGreaterThan(scrollSpeedBeforeDrag)

      await app.setup.mockMouse.release(textarea.x + 1, textarea.y)
      await app.waitFor(() => app.setup.renderer.getSelection()?.isDragging === false)

      expect(textarea.showCursor).toBe(true)
      expect(textarea.live).toBe(liveBeforeDrag)
      expect(textarea.scrollSpeed).toBe(scrollSpeedBeforeDrag)
    } finally {
      app.destroy()
    }
  })

  test("highlights lines revealed by drag selection autoscroll", async () => {
    const text = Array.from({ length: 80 }, (_, i) => `select ${i} as value`).join("\n")
    const app = await mountBuffer({ text, width: 40, height: 8, analysis: createLineHighlightAnalysis() })

    try {
      const textarea = getBufferTextarea(app)
      await app.waitFor(() => textarea.getLineHighlights(0).length > 0)

      await app.setup.mockMouse.pressDown(textarea.x + 1, textarea.y + 1)
      await app.setup.mockMouse.moveTo(textarea.x + 1, textarea.y + textarea.height - 1)
      await app.waitFor(() => {
        const revealedLine = Math.min(textarea.lineCount - 1, textarea.scrollY + textarea.height - 1)
        return textarea.scrollY > 0 && textarea.getLineHighlights(revealedLine).length > 0
      })

      expect(textarea.showCursor).toBe(false)

      await app.setup.mockMouse.release(textarea.x + 1, textarea.y + textarea.height - 1)
      await app.waitFor(() => app.setup.renderer.getSelection()?.isDragging === false)
    } finally {
      app.destroy()
    }
  })

  test("keeps cursor visible and scroll state aligned across scrollbar appearance and burst enter", async () => {
    const line =
      'select author_id, book_id, created_at, updated_at from books where title like "very long wrapped title" and status = "published" order by created_at desc;'
    const widthBeforeScrollbar = 30
    const widthAfterScrollbar = 29
    const enterPressesBeforeScrollbar = 2
    const burstEnterPresses = 16
    const cursorOffsetAfterBurst = 18
    const app = await mountBuffer({ text: `${line}\n`, width: 34, height: 8 })

    try {
      const textarea = getBufferTextarea(app)
      const scrollbox = getBufferScrollbox(app)

      const mountedState = captureScrollState(textarea, scrollbox)

      expect(mountedState.thumbVisible).toBe(false)
      expect(mountedState.textareaWidth).toBe(widthBeforeScrollbar)
      expectScrollStateAligned(mountedState)

      for (let i = 0; i < enterPressesBeforeScrollbar; i += 1) {
        app.setup.mockInput.pressEnter()
      }
      await app.waitFor(() => scrollbox.verticalScrollBar.visible)
      await app.waitFor(() => textarea.width === widthAfterScrollbar)
      const stateAfterScrollbarAppears = captureScrollState(textarea, scrollbox)

      expect(stateAfterScrollbarAppears.thumbVisible).toBe(true)
      expect(stateAfterScrollbarAppears.textareaWidth).toBe(widthAfterScrollbar)
      expectScrollStateAligned(stateAfterScrollbarAppears)

      for (let i = 0; i < burstEnterPresses; i += 1) {
        app.setup.mockInput.pressEnter()
      }
      await app.waitFor(() => textarea.cursorOffset === cursorOffsetAfterBurst)
      await app.waitFor(() => textarea.scrollY > 0)
      const stateAfterBurstEnter = captureScrollState(textarea, scrollbox)

      expect(stateAfterBurstEnter.thumbVisible).toBe(true)
      expectScrollStateAligned(stateAfterBurstEnter)
    } finally {
      app.destroy()
    }
  })

  test("keeps the rendered editor pinned to the viewport during burst enter spam", async () => {
    const line =
      'select author_id, book_id, created_at, updated_at from books where title like "very long wrapped title" and status = "published" order by created_at desc;'
    const enterPressesBeforeScrollbar = 2
    const burstEnterPresses = 16
    const app = await mountBuffer({ text: `${line}\n`, width: 34, height: 8 })

    try {
      const textarea = getBufferTextarea(app)
      const scrollbox = getBufferScrollbox(app)
      const lineNumber = getBufferLineNumber(app)
      const scrolledFrames = [] as Array<{
        cursorVisualRow: number
        frameCursorY: number
        lineNumberScreenY: number
        textareaScreenY: number
        viewportScreenY: number
        viewportHeight: number
      }>

      for (let i = 0; i < enterPressesBeforeScrollbar; i += 1) {
        app.setup.mockInput.pressEnter()
      }
      await app.waitFor(() => scrollbox.verticalScrollBar.visible)

      for (let i = 0; i < burstEnterPresses; i += 1) {
        app.setup.mockInput.pressEnter()
        await app.setup.renderOnce()
        if (textarea.scrollY > 0) {
          const frame = app.setup.captureSpans()
          scrolledFrames.push({
            cursorVisualRow: textarea.visualCursor.visualRow,
            frameCursorY: frame.cursor[1] ?? -1,
            lineNumberScreenY: lineNumber.screenY,
            textareaScreenY: textarea.screenY,
            viewportScreenY: scrollbox.viewport.screenY,
            viewportHeight: scrollbox.viewport.height,
          })
        }
        await app.setup.renderOnce()
        if (textarea.scrollY > 0) {
          const frame = app.setup.captureSpans()
          scrolledFrames.push({
            cursorVisualRow: textarea.visualCursor.visualRow,
            frameCursorY: frame.cursor[1] ?? -1,
            lineNumberScreenY: lineNumber.screenY,
            textareaScreenY: textarea.screenY,
            viewportScreenY: scrollbox.viewport.screenY,
            viewportHeight: scrollbox.viewport.height,
          })
        }
      }

      expect(scrolledFrames.length).toBeGreaterThan(0)
      for (const frame of scrolledFrames) {
        expect(frame.lineNumberScreenY).toBe(frame.viewportScreenY)
        expect(frame.textareaScreenY).toBe(frame.viewportScreenY)
        expect(frame.frameCursorY).toBe(frame.textareaScreenY + frame.cursorVisualRow + 1)
        expect(frame.frameCursorY).toBeLessThanOrEqual(frame.viewportScreenY + frame.viewportHeight)
      }
    } finally {
      app.destroy()
    }
  })

  test("reclamps the viewport after a scrolled buffer shrinks", async () => {
    const enterPresses = 18
    const arrowUpPresses = 4
    const backspacePresses = 4
    const app = await mountBuffer({ text: "", width: 24, height: 8 })

    try {
      const textarea = getBufferTextarea(app)
      const scrollbox = getBufferScrollbox(app)

      for (let i = 0; i < enterPresses; i += 1) {
        app.setup.mockInput.pressEnter()
      }
      await app.waitFor(() => textarea.logicalCursor.row === enterPresses)
      await app.waitFor(() => textarea.scrollY > 0)

      for (let i = 0; i < arrowUpPresses; i += 1) {
        app.setup.mockInput.pressArrow("up")
      }
      await app.waitFor(() => textarea.logicalCursor.row === enterPresses - arrowUpPresses)

      for (let i = 1; i <= backspacePresses; i += 1) {
        app.setup.mockInput.pressBackspace()
        await app.waitFor(() => textarea.logicalCursor.row === enterPresses - arrowUpPresses - i)

        const state = captureScrollState(textarea, scrollbox)
        const maxTop = Math.max(0, state.totalVirtualLineCount - state.editorHeight)
        expectScrollStateAligned(state)
        expect(state.editorScrollY).toBeLessThanOrEqual(maxTop)
        expect(state.scrollboxTop).toBeLessThanOrEqual(maxTop)
      }
    } finally {
      app.destroy()
    }
  })

  test("does not move the cursor until scrolling pushes it into the viewport band", async () => {
    const text = Array.from({ length: 24 }, (_, i) => `line-${i}`).join("\n")
    const app = await mountBuffer({ text, width: 24, height: 8 })

    try {
      const textarea = getBufferTextarea(app)
      const scrollbox = getBufferScrollbox(app)
      await moveCursor(app, textarea, 4, 0)
      await app.waitFor(() => textarea.logicalCursor.row === 4 && textarea.scrollY === 0)

      await app.setup.mockMouse.scroll(textarea.x + 1, textarea.y + 1, "down")
      await app.waitFor(() => textarea.scrollY === 1)
      let state = captureScrollState(textarea, scrollbox)
      expect(state.cursorLogicalRow).toBe(4)
      expect(state.cursorVisualRow).toBe(3)

      await app.setup.mockMouse.scroll(textarea.x + 1, textarea.y + 1, "down")
      await app.waitFor(() => textarea.scrollY === 2)
      state = captureScrollState(textarea, scrollbox)
      expect(state.cursorLogicalRow).toBe(4)
      expect(state.cursorVisualRow).toBe(2)

      await app.setup.mockMouse.scroll(textarea.x + 1, textarea.y + 1, "down")
      await app.waitFor(() => textarea.scrollY === 3)
      state = captureScrollState(textarea, scrollbox)
      expect(state.cursorLogicalRow).toBe(5)
      expect(state.cursorVisualRow).toBe(2)
      expect(state.editorScrollY).toBe(state.scrollboxTop)
    } finally {
      app.destroy()
    }
  })

  test("keeps split sgr mouse tails out of text when scroll sync is slow", async () => {
    const text = Array.from({ length: 20 }, (_, i) => `line-${i}`).join("\n")
    const app = await mountBuffer({ text, width: 24, height: 8, analysis: createBlockingAnalysis(40) })

    try {
      const textarea = getBufferTextarea(app)
      const x = textarea.x + 1
      const y = textarea.y + 1

      app.setup.renderer.stdin.emit("data", Buffer.from(`${createRawScrollSequence(x, y)}\u001b[`))
      await waitForImmediate()
      app.setup.renderer.stdin.emit("data", Buffer.from(`<65;${x + 1};${y + 1}M`))
      await app.waitFor(() => textarea.scrollY > 0)

      expect(textarea.plainText).toBe(text)
    } finally {
      app.destroy()
    }
  })

  test("extends highlights for newly revealed lines of the same statement on first scroll", async () => {
    const row = [
      'INSERT INTO "Orders"',
      '("OrderID","CustomerID","EmployeeID","OrderDate","RequiredDate",',
      '\t"ShippedDate","ShipVia","Freight","ShipName","ShipAddress",',
      '\t"ShipCity","ShipRegion","ShipPostalCode","ShipCountry")',
      "VALUES (10958,N'OCEAN',7,'3/18/1998','4/15/1998','3/27/1998',2,49.56,",
      "\tN'Oceano Atlantico Ltda.',N'Ing. Gustavo Moncada 8585 Piso 20-A',N'Buenos Aires',",
      "\tNULL,N'1010',N'Argentina')",
    ].join("\n")
    const sql = Array.from({ length: 6 }, (_, index) => row.replace("10958", String(10000 + index))).join("\n")
    const app = await mountBuffer({ text: sql, width: 72, height: 4 })

    try {
      const textarea = getBufferTextarea(app)

      await app.waitFor(() => textarea.getLineHighlights(0).length > 0)
      expect(textarea.getLineHighlights(20).length).toBe(0)

      for (let i = 0; i < 18; i += 1) {
        await app.setup.mockMouse.scroll(textarea.x + 1, textarea.y + 1, "down")
        await app.renderOnce()
      }

      expect(textarea.scrollY).toBeGreaterThanOrEqual(16)
      expect(textarea.getLineHighlights(19).length).toBeGreaterThan(0)
    } finally {
      app.destroy()
    }
  })

  test("keeps a shifted visible GO-delimited insert block highlighted after inserting the same block", async () => {
    const block = `INSERT INTO "Records"
("Id","Code","Label")
VALUES (1,N'alpha',N'one')`
    const inserted = `${block}\nGO\n`
    const text = [block, "GO", block, "GO", block].join("\n")
    const expectedText = [block, "GO", block, "GO", block, "GO", block].join("\n")
    const app = await mountBuffer({ text, width: 72, height: 20 })

    try {
      const textarea = getBufferTextarea(app)

      await app.waitFor(
        () =>
          textarea.getLineHighlights(8).length > 0 &&
          textarea.getLineHighlights(9).length > 0 &&
          textarea.getLineHighlights(10).length > 0,
      )
      await moveCursor(app, textarea, 8, 0)

      await app.setup.mockInput.pasteBracketedText(inserted)
      await app.waitFor(() => textarea.plainText === expectedText)

      expect(textarea.getLineHighlights(12).length).toBeGreaterThan(0)
      expect(textarea.getLineHighlights(13).length).toBeGreaterThan(0)
      expect(textarea.getLineHighlights(14).length).toBeGreaterThan(0)

      await app.setup.renderOnce()

      expect(textarea.getLineHighlights(12).length).toBeGreaterThan(0)
      expect(textarea.getLineHighlights(13).length).toBeGreaterThan(0)
      expect(textarea.getLineHighlights(14).length).toBeGreaterThan(0)
    } finally {
      app.destroy()
    }
  })

  test("keeps the pasted cursor visible after prior wheel scrolling", async () => {
    const text = Array.from({ length: 40 }, (_, i) => `line-${i}`).join("\n")
    const pasted = "\nalpha\nbeta\ngamma\ndelta\nepsilon\nzeta\neta\ntheta\niota\n"
    const app = await mountBuffer({ text, width: 24, height: 8 })

    try {
      const textarea = getBufferTextarea(app)
      const scrollbox = getBufferScrollbox(app)

      textarea.focus()
      await moveCursor(app, textarea, 8, -1)
      await app.waitFor(() => textarea.logicalCursor.row === 8)

      for (let i = 0; i < 4; i += 1) {
        await app.setup.mockMouse.scroll(textarea.x + 1, textarea.y + 1, "down")
        await app.renderOnce()
      }
      await app.waitFor(() => textarea.scrollY > 0)
      const scrollBeforePaste = textarea.scrollY

      await app.setup.mockInput.pasteBracketedText(pasted)
      await app.waitFor(() => textarea.plainText.includes("theta"))
      await app.waitFor(() => textarea.logicalCursor.row > 8)
      await app.waitFor(() => textarea.scrollY > scrollBeforePaste)

      const state = captureScrollState(textarea, scrollbox)
      expect(state.editorScrollY).toBe(state.scrollboxTop)
      expect(state.cursorVisualRow).toBeGreaterThanOrEqual(0)
      expect(state.cursorVisualRow).toBeLessThan(state.editorHeight)
      expect(state.cursorLogicalRow).toBeGreaterThan(8)
      expect(state.editorScrollY).toBeGreaterThan(scrollBeforePaste)
    } finally {
      app.destroy()
    }
  })

  test("uses visual rows for viewport clamping during scroll", async () => {
    const fixture = createWrappedScrollLockFixture()
    const app = await mountBuffer({ text: fixture.text, width: 48, height: 8 })

    try {
      const textarea = getBufferTextarea(app)
      const scrollbox = getBufferScrollbox(app)
      const scrollNode = scrollbox as unknown as { onMouseEvent: (event: MouseEvent) => void }
      const scrollEvent = {
        type: "scroll",
        x: scrollbox.viewport.x + 1,
        y: scrollbox.viewport.y + 1,
        modifiers: { shift: false, alt: false, ctrl: false },
        scroll: { direction: "down", delta: 1 },
      } as unknown as MouseEvent

      await moveCursor(app, textarea, fixture.longLineRow, 0)
      await app.waitFor(() => textarea.logicalCursor.row === fixture.longLineRow)

      for (let i = 0; i < 80; i += 1) {
        scrollNode.onMouseEvent(scrollEvent)
        await app.renderOnce()
      }

      const state = captureScrollState(textarea, scrollbox)
      const visible = readVisibleLines(app)

      expect(state.editorScrollY).toBe(state.scrollboxTop)
      expect(state.editorScrollY).toBeGreaterThan(fixture.longLineRow)
      expect(state.cursorLogicalRow).toBeGreaterThan(fixture.longLineRow)
      expect(fixture.tail.some((entry) => visible.some((line) => line.includes(entry)))).toBe(true)
    } finally {
      app.destroy()
    }
  })

  // Working around opentui bug
  test("keeps the final blank line stable after ctrl+e ctrl+u on the last line", async () => {
    const text =
      "select * from authors;\n\nselect * from books limit 10;\n\n\nselect * from authors a\njoin books b on a.id = b.author_id "
    const expected = "select * from authors;\n\nselect * from books limit 10;\n\n\nselect * from authors a\n"
    const app = await mountBuffer({ text, width: 80, height: 20 })

    try {
      const textarea = getBufferTextarea(app)

      textarea.gotoLine(6)
      await app.waitFor(() => textarea.logicalCursor.row === 6)
      textarea.gotoLineEnd()
      await app.waitFor(() => textarea.logicalCursor.row === 6 && textarea.logicalCursor.col === 35)

      app.setup.mockInput.pressKey("e", { ctrl: true })
      await app.renderOnce()
      app.setup.mockInput.pressKey("u", { ctrl: true })

      await app.waitFor(() => textarea.plainText === expected)
      await app.waitFor(() => textarea.logicalCursor.row === 6 && textarea.logicalCursor.col === 0)
      await app.waitFor(() => textarea.visualCursor.logicalRow === 6 && textarea.visualCursor.logicalCol === 0)

      expect(textarea.lineCount).toBe(7)
      expect(textarea.virtualLineCount).toBe(7)
      expect(textarea.lineInfo.lineSources).toEqual([0, 1, 2, 3, 4, 5, 6])
      expect(textarea.cursorOffset).toBe(expected.length)
      expect(readFrameLines(app).some((line) => line.trimStart().startsWith("7"))).toBe(true)

      app.setup.mockInput.pressArrow("down")
      await app.renderOnce()

      expect(textarea.logicalCursor.row).toBe(6)
      expect(textarea.logicalCursor.col).toBe(0)
      expect(textarea.visualCursor.logicalRow).toBe(6)
      expect(textarea.visualCursor.logicalCol).toBe(0)

      app.setup.mockInput.pressArrow("right", { meta: true })
      await app.renderOnce()

      expect(textarea.logicalCursor.row).toBe(6)
      expect(textarea.logicalCursor.col).toBe(0)
      expect(textarea.cursorOffset).toBe(expected.length)
    } finally {
      app.destroy()
    }
  })

  // Should be removed once we have fix for ctrl-u bug on last line in opentui core
  test("preserves repeated ctrl+u behavior away from EOF", async () => {
    const text = "Line 1\nLine 2\nLine 3\nLine 4"
    const app = await mountBuffer({ text, width: 40, height: 12 })

    try {
      const textarea = getBufferTextarea(app)

      textarea.gotoLine(2)
      await app.waitFor(() => textarea.logicalCursor.row === 2)
      textarea.gotoLineEnd()
      await app.waitFor(() => textarea.logicalCursor.row === 2 && textarea.logicalCursor.col === 6)

      app.setup.mockInput.pressKey("u", { ctrl: true })
      await app.waitFor(() => textarea.plainText === "Line 1\nLine 2\n\nLine 4")
      expect(textarea.logicalCursor.row).toBe(2)
      expect(textarea.logicalCursor.col).toBe(0)

      app.setup.mockInput.pressKey("u", { ctrl: true })
      await app.waitFor(() => textarea.plainText === "Line 1\nLine 2\nLine 4")
      expect(textarea.logicalCursor.row).toBe(1)
      expect(textarea.logicalCursor.col).toBe(6)
    } finally {
      app.destroy()
    }
  })

  test("does not scroll downward after ctrl+u at the end of a long wrapped line", async () => {
    const fixture = createWrappedScrollLockFixture()
    const app = await mountBuffer({ text: fixture.text, width: 48, height: 8 })

    try {
      const textarea = getBufferTextarea(app)
      const scrollbox = getBufferScrollbox(app)
      const beforeLine = fixture.text.split("\n")[fixture.longLineRow] ?? ""

      await moveCursor(app, textarea, fixture.longLineRow, beforeLine.length)
      await app.waitFor(() => textarea.logicalCursor.row === fixture.longLineRow)
      const beforeScrollY = textarea.scrollY

      app.setup.mockInput.pressKey("u", { ctrl: true })
      await app.waitFor(() => textarea.logicalCursor.row === fixture.longLineRow && textarea.logicalCursor.col === 0)

      const state = captureScrollState(textarea, scrollbox)
      expect(state.editorScrollY).toBe(state.scrollboxTop)
      expect(state.editorScrollY).toBeLessThanOrEqual(beforeScrollY)
      expect(state.cursorVisualRow).toBeGreaterThanOrEqual(0)
      expect(state.cursorVisualRow).toBeLessThan(state.editorHeight)
    } finally {
      app.destroy()
    }
  })
})
