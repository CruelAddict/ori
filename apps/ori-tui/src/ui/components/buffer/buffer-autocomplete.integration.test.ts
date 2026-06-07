import { describe, expect, test } from "bun:test"
import { type Node, NodeType } from "@adapters/ori/client"
import { BoxRenderable } from "@opentui/core"
import type { MountedTuiApp } from "../../../test/opentui-harness"
import { readFrameText } from "../../../test/opentui-test-tools"
import { createSqlEditorBgWorkerAdapter } from "../../widgets/editor-panel/sql-editor-bg-worker-adapter"
import type { SqlEditorSchemaState } from "../../widgets/editor-panel/sql-editor-protocol"
import { getBufferTextarea, mountBufferWithApi, mountText, moveCursor } from "./buffer.test-tools"
import { type DocCharOffset, docCharOffset, docCharRange } from "./coords"
import { Document } from "./document"

function popupBox(app: MountedTuiApp) {
  return app.find((node): node is BoxRenderable => node instanceof BoxRenderable && node.zIndex === 30)
}

function showsCompletion(app: MountedTuiApp, label: string) {
  return Boolean(popupBox(app)) && readFrameText(app).includes(label)
}

async function waitForCompletion(app: MountedTuiApp, label: string, timeoutMs = 500) {
  await app.waitFor(() => showsCompletion(app, label), timeoutMs)
}

function createSchemaState(databaseId = "db"): SqlEditorSchemaState {
  const nodes: Node[] = [
    {
      id: databaseId,
      name: "warehouse",
      type: NodeType.DATABASE,
      edges: { schemas: { items: ["schema:public"], truncated: false } },
      attributes: { resource: "test", engine: "postgres", isDefault: true },
    },
    {
      id: "schema:public",
      name: "public",
      type: NodeType.SCHEMA,
      edges: { tables: { items: ["table:public.authors", "table:public.books"], truncated: false } },
      attributes: { resource: "test", engine: "postgres", isDefault: true },
    },
    {
      id: "table:public.authors",
      name: "authors",
      type: NodeType.TABLE,
      edges: { columns: { items: [], truncated: false } },
      attributes: { resource: "test", table: "authors", tableType: "table" },
    },
    {
      id: "table:public.books",
      name: "books",
      type: NodeType.TABLE,
      edges: { columns: { items: [], truncated: false } },
      attributes: { resource: "test", table: "books", tableType: "table" },
    },
  ]
  return {
    rootIds: [databaseId],
    nodesById: Object.fromEntries(nodes.map((node) => [node.id, node])),
    loading: false,
    loaded: true,
  }
}

function createWorkerProvider() {
  const state = createSchemaState()
  return createSqlEditorBgWorkerAdapter({
    getState: () => state,
  })
}

function createMutableWorkerProvider() {
  let state: SqlEditorSchemaState = {
    rootIds: [],
    nodesById: {},
    loading: true,
    loaded: false,
  }
  const listeners = new Set<() => void>()
  const worker = createSqlEditorBgWorkerAdapter({
    getState: () => state,
    subscribeState: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  })

  return {
    worker,
    setState: (next: SqlEditorSchemaState) => {
      state = next
      for (const listener of listeners) {
        listener()
      }
    },
  }
}

function endOffset(text: string): DocCharOffset {
  return docCharOffset(text.length)
}

function createStaticAutocomplete(label: string, insertText = label) {
  return {
    getCompletions: async ({ text, cursor }: { text: string; cursor: number }) => ({
      replace: docCharRange(
        docCharOffset(cursor - (text.slice(0, cursor).match(/[A-Za-z_][A-Za-z0-9_$]*$/)?.[0].length ?? 0)),
        docCharOffset(cursor),
      ),
      items: [{ id: label, label, insertText }],
    }),
  }
}

describe("buffer autocomplete integration", () => {
  test("opens relations after typing prefix", async () => {
    const worker = createWorkerProvider()
    const mounted = await mountBufferWithApi({ width: 80, height: 20, autocomplete: worker.autocomplete })

    try {
      const textarea = getBufferTextarea(mounted.app)
      const text = "\tfoo\n\tbar\nselect * from aut"
      const nextText = "\tfoo\n\tbar\nselect * from auth"

      await mountText(mounted, textarea, text)
      await moveCursor(mounted.app, textarea, 2, -1)

      await mounted.app.setup.mockInput.typeText("h")
      await mounted.app.waitFor(() => textarea.plainText === nextText)

      await waitForCompletion(mounted.app, "authors")
      expect(readFrameText(mounted.app)).toContain("authors")
    } finally {
      worker.dispose()
      mounted.app.destroy()
    }
  })

  test("does not reopen autocomplete when schema finishes loading after no popup was opened", async () => {
    const databaseId = "db"
    const provider = createMutableWorkerProvider()
    const mounted = await mountBufferWithApi({ width: 80, height: 20, autocomplete: provider.worker.autocomplete })

    try {
      const textarea = getBufferTextarea(mounted.app)
      const text = "select * from al"
      const nextText = "select * from all"

      await mountText(mounted, textarea, text)
      await moveCursor(mounted.app, textarea, 0, -1)

      await mounted.app.setup.mockInput.typeText("l")
      await mounted.app.waitFor(() => textarea.plainText === nextText)

      provider.setState(createSchemaState(databaseId))
      await mounted.app.renderOnce()

      expect(popupBox(mounted.app)).toBeUndefined()
    } finally {
      provider.worker.dispose()
      mounted.app.destroy()
    }
  })

  test("positions popup under the replace range start on a later line", async () => {
    const linePrefix = "select * "
    const text = `select * from authors\n${linePrefix}f`
    const nextText = `select * from authors\n${linePrefix}fr`
    const replaceStart = nextText.lastIndexOf("fr")
    const mounted = await mountBufferWithApi({
      width: 80,
      height: 20,
      autocomplete: {
        getCompletions: async () => ({
          replace: docCharRange(replaceStart, text.length),
          items: [{ id: "keyword:from", label: "from", insertText: "from" }],
        }),
      },
    })

    try {
      const textarea = getBufferTextarea(mounted.app)

      await mountText(mounted, textarea, text)
      await moveCursor(mounted.app, textarea, 1, -1)
      await mounted.app.setup.mockInput.typeText("r")
      await mounted.app.waitFor(() => textarea.plainText === nextText)
      await waitForCompletion(mounted.app, "from")

      const popup = popupBox(mounted.app)

      expect(popup).toBeDefined()
      expect(popup?.x).toBe(textarea.x + linePrefix.length - 1)
    } finally {
      mounted.app.destroy()
    }
  })

  test("returns relations at cursor", async () => {
    const worker = createWorkerProvider()

    try {
      const text = "\tfoo\n\tbar\nselect * from auth"
      const result = await worker.autocomplete.getCompletions({
        text,
        cursor: endOffset(text),
        signal: new AbortController().signal,
      })

      expect(result?.items.map((item) => item.label)).toContain("authors")
    } finally {
      worker.dispose()
    }
  })

  test("maps cursor below earlier tabbed lines", async () => {
    const mounted = await mountBufferWithApi({
      width: 100,
      height: 24,
      autocomplete: { getCompletions: async () => undefined },
    })

    try {
      const textarea = getBufferTextarea(mounted.app)
      const prefix = "\tfoo\n\tbar\n"
      const text = `${prefix}select * from auth`
      const line = 2
      const lineStart = prefix.length
      const cursor = endOffset(text)
      const tabsBeforeLine = 2
      const tabsBeforeCursor = 2

      await mountText(mounted, textarea, text)
      textarea.gotoLine(line)
      await mounted.app.waitFor(() => textarea.logicalCursor.row === line)
      const afterGotoLine = { ...textarea.logicalCursor }
      const eolAfterGotoLine = textarea.editBuffer.getEOL()
      await moveCursor(mounted.app, textarea, line, -1)

      const document = Document.create(textarea.plainText)
      const rebuilt = document.offsetAtLineChar(textarea.logicalCursor.row, textarea.logicalCursor.col)
      const rebuiltLineStart = document.offsetAtLineChar(afterGotoLine.row, afterGotoLine.col)

      expect(tabsBeforeLine).toBe(2)
      expect(tabsBeforeCursor).toBe(2)
      expect(afterGotoLine.offset).toBe(lineStart + tabsBeforeLine)
      expect(rebuiltLineStart).toBe(docCharOffset(lineStart))
      expect(eolAfterGotoLine.offset).toBe(cursor + tabsBeforeCursor)
      expect(textarea.logicalCursor.offset).toBe(cursor + tabsBeforeCursor)
      expect(rebuilt).toBe(cursor)
    } finally {
      mounted.app.destroy()
    }
  })

  test("replaces the active identifier", async () => {
    const worker = createWorkerProvider()
    const mounted = await mountBufferWithApi({ width: 100, height: 24, autocomplete: worker.autocomplete })

    try {
      const textarea = getBufferTextarea(mounted.app)
      const text = "\tfoo\n\tbar\nselect * from aut"
      const nextText = "\tfoo\n\tbar\nselect * from auth"
      const expected = "\tfoo\n\tbar\nselect * from authors"

      await mountText(mounted, textarea, text)
      await moveCursor(mounted.app, textarea, 2, -1)
      await mounted.app.setup.mockInput.typeText("h")
      await mounted.app.waitFor(() => textarea.plainText === nextText)
      await waitForCompletion(mounted.app, "authors")

      mounted.app.setup.mockInput.pressEnter()
      await mounted.app.waitFor(() => textarea.plainText === expected)

      expect(textarea.plainText).toBe(expected)
    } finally {
      worker.dispose()
      mounted.app.destroy()
    }
  })

  test("inserts a relation at the boundary", async () => {
    const worker = createWorkerProvider()
    const mounted = await mountBufferWithApi({ width: 100, height: 24, autocomplete: worker.autocomplete })

    try {
      const textarea = getBufferTextarea(mounted.app)
      const text = "\tfoo\n\tbar\nselect * from"
      const expectedLine = "select * from authors"
      const expectedText = "\tfoo\n\tbar\nselect * from authors"

      await mountText(mounted, textarea, text)
      await moveCursor(mounted.app, textarea, 2, -1)
      await mounted.app.setup.mockInput.typeText(" ")
      await mounted.app.waitFor(() => textarea.plainText === "\tfoo\n\tbar\nselect * from ")
      await waitForCompletion(mounted.app, "authors")

      mounted.app.setup.mockInput.pressEnter()
      await mounted.app.waitFor(
        () => textarea.plainText === expectedText && textarea.logicalCursor.col === expectedLine.length,
      )

      expect(textarea.plainText).toBe(expectedText)
      expect(textarea.logicalCursor.col).toBe(expectedLine.length)
    } finally {
      worker.dispose()
      mounted.app.destroy()
    }
  })

  test("does not open autocomplete on mouse click after moving the cursor", async () => {
    const mounted = await mountBufferWithApi({
      width: 80,
      height: 20,
      autocomplete: createStaticAutocomplete("select"),
    })

    try {
      const textarea = getBufferTextarea(mounted.app)
      const text = "selec"

      await mountText(mounted, textarea, text)
      await moveCursor(mounted.app, textarea, 0, -1)
      await mounted.app.setup.mockMouse.click(textarea.x + text.length, textarea.y)
      await mounted.app.renderOnce()

      expect(popupBox(mounted.app)).toBeUndefined()
    } finally {
      mounted.app.destroy()
    }
  })

  test("does not open autocomplete after paste", async () => {
    const mounted = await mountBufferWithApi({
      width: 80,
      height: 20,
      autocomplete: createStaticAutocomplete("from"),
    })

    try {
      const textarea = getBufferTextarea(mounted.app)
      const text = "select * "
      const nextText = "select * fro"

      await mountText(mounted, textarea, text)
      await moveCursor(mounted.app, textarea, 0, -1)
      await mounted.app.setup.mockInput.pasteBracketedText("fro")
      await mounted.app.waitFor(() => textarea.plainText === nextText)
      await mounted.app.renderOnce()

      expect(popupBox(mounted.app)).toBeUndefined()
    } finally {
      mounted.app.destroy()
    }
  })

  test("opens autocomplete after tab inserts the configured indentation", async () => {
    const mounted = await mountBufferWithApi({
      width: 100,
      height: 24,
      autocomplete: createStaticAutocomplete("authors"),
    })

    try {
      const textarea = getBufferTextarea(mounted.app)
      const text = "select * from"
      const nextText = "select * from  "

      await mountText(mounted, textarea, text)
      await moveCursor(mounted.app, textarea, 0, -1)
      mounted.app.setup.mockInput.pressTab()
      await mounted.app.waitFor(() => textarea.plainText === nextText)

      await waitForCompletion(mounted.app, "authors")
      expect(readFrameText(mounted.app)).toContain("authors")
    } finally {
      mounted.app.destroy()
    }
  })

  test("closes autocomplete when the cursor leaves the active replace range", async () => {
    const mounted = await mountBufferWithApi({
      width: 100,
      height: 24,
      autocomplete: createStaticAutocomplete("authors"),
    })

    try {
      const textarea = getBufferTextarea(mounted.app)
      const text = "select * from aut"
      const nextText = "select * from auth"
      const replaceStart = nextText.lastIndexOf("auth")

      await mountText(mounted, textarea, text)
      await moveCursor(mounted.app, textarea, 0, -1)
      await mounted.app.setup.mockInput.typeText("h")
      await mounted.app.waitFor(() => textarea.plainText === nextText)
      await waitForCompletion(mounted.app, "authors")

      for (let i = 0; i < 5; i += 1) {
        mounted.app.setup.mockInput.pressArrow("left")
      }

      await mounted.app.waitFor(() => textarea.logicalCursor.col < replaceStart)
      await mounted.app.waitFor(() => popupBox(mounted.app) === undefined)
    } finally {
      mounted.app.destroy()
    }
  })
})
