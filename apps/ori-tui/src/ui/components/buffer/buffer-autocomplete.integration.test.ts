import { describe, expect, test } from "bun:test"
import { type Node, NodeType } from "@adapters/ori/client"
import { BoxRenderable } from "@opentui/core"
import type { MountedTuiApp } from "../../../test/opentui-harness"
import { readFrameText } from "../../../test/opentui-test-tools"
import { createSqlEditorBgWorkerAdapter } from "../../widgets/editor-panel/sql-editor-bg-worker-adapter"
import type { SqlEditorSchemaState } from "../../widgets/editor-panel/sql-editor-protocol"
import { getBufferTextarea, mountBufferWithApi, mountText, moveCursor } from "./buffer.test-tools"
import { resolveCursorDocOffset } from "./buffer-opentui-adapter"
import { type DocCharOffset, docCharOffset, docCharRange } from "./coords"

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

  test("reopens autocomplete when schema finishes loading after typing an exact sql keyword", async () => {
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

      await waitForCompletion(mounted.app, "authors")
      expect(readFrameText(mounted.app)).toContain("books")
    } finally {
      provider.worker.dispose()
      mounted.app.destroy()
    }
  })

  test("positions popup under the replace range start on a later line", async () => {
    const linePrefix = "select * "
    const text = `select * from authors\n${linePrefix}fr`
    const replaceStart = text.lastIndexOf("fr")
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

      const rebuilt = resolveCursorDocOffset(textarea.plainText, textarea.logicalCursor.row, textarea.logicalCursor.col)
      const rebuiltLineStart = resolveCursorDocOffset(textarea.plainText, afterGotoLine.row, afterGotoLine.col)

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
      const text = "\tfoo\n\tbar\nselect * from auth"
      const expected = "\tfoo\n\tbar\nselect * from authors"

      await mountText(mounted, textarea, text)
      await moveCursor(mounted.app, textarea, 2, -1)
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
      const text = "\tfoo\n\tbar\nselect * from "
      const expectedLine = "select * from authors"
      const expectedText = "\tfoo\n\tbar\nselect * from authors"

      await mountText(mounted, textarea, text)
      await moveCursor(mounted.app, textarea, 2, -1)
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
})
