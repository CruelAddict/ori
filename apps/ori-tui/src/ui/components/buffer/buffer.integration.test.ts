import { describe, expect, test } from "bun:test"
import { LineNumberRenderable, type ScrollBoxRenderable, type TextareaRenderable } from "@opentui/core"
import type { MountedTuiApp } from "../../../test/opentui-harness"
import { findRequiredNode, readFrameLines, readFrameLineTokens } from "../../../test/opentui-test-tools"
import type { BufferContext } from "./buffer"
import { getBufferScrollbox, getBufferTextarea, mountBuffer } from "./buffer.test-tools"

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
  latestContext: BufferContext | undefined,
) {
  return {
    cursorOffset: textarea.cursorOffset,
    cursorLogicalRow: textarea.logicalCursor.row,
    cursorVisualRow: textarea.visualCursor.visualRow,
    editorScrollY: textarea.scrollY,
    scrollboxTop: scrollbox.scrollTop ?? 0,
    contextOffset: latestContext?.cursorOffset,
    focusedRow: latestContext?.focusedRow,
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

  test("keeps buffer context aligned with OpenTUI cursor after mouse clicks", async () => {
    const text = `${Array.from({ length: 20 }, (_, i) => `line-${i}`).join("\n")}\n`
    const clickColumnOffset = 2
    const initialClickRowOffset = 2
    const scrolledClickRowOffset = 1
    const arrowDownPresses = 12
    let latestContext: BufferContext | undefined
    const app = await mountBuffer({
      text,
      width: 30,
      height: 8,
      onContextChange: (context) => {
        latestContext = context
      },
    })

    try {
      const textarea = getBufferTextarea(app)
      const scrollbox = getBufferScrollbox(app)

      await app.waitFor(() => latestContext?.cursorOffset === 0)

      await app.setup.mockMouse.click(textarea.x + clickColumnOffset, textarea.y + initialClickRowOffset)
      await app.waitFor(() => (latestContext?.cursorOffset ?? -1) === textarea.cursorOffset)
      const stateAfterClick = captureCursorState(textarea, scrollbox, latestContext)

      expectCursorContextSync(stateAfterClick)

      for (let i = 0; i < arrowDownPresses; i += 1) {
        app.setup.mockInput.pressArrow("down")
      }
      await app.waitFor(() => (scrollbox.scrollTop ?? 0) > 0)
      await app.waitFor(() => (latestContext?.cursorOffset ?? -1) === textarea.cursorOffset)
      const stateAfterKeyScroll = captureCursorState(textarea, scrollbox, latestContext)

      expect(stateAfterKeyScroll.editorScrollY).toBe(stateAfterKeyScroll.scrollboxTop)
      expectCursorContextSync(stateAfterKeyScroll)

      await app.setup.mockMouse.click(textarea.x + clickColumnOffset, textarea.y + scrolledClickRowOffset)
      await app.waitFor(() => textarea.visualCursor.visualRow === 1)
      await app.waitFor(() => (latestContext?.cursorOffset ?? -1) === textarea.cursorOffset)
      const stateAfterScrolledClick = captureCursorState(textarea, scrollbox, latestContext)

      expect(stateAfterScrolledClick.editorScrollY).toBe(stateAfterScrolledClick.scrollboxTop)
      expect(stateAfterScrolledClick.cursorVisualRow).toBe(1)
      expectCursorContextSync(stateAfterScrolledClick)
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
})
