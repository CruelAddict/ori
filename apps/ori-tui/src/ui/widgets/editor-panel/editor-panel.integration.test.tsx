import { describe, expect, test } from "bun:test"
import { type Node, NodeType } from "@adapters/ori/client"
import { LineNumberRenderable, type TextareaRenderable } from "@opentui/core"
import { getBufferTextarea, moveCursor } from "@ui/components/buffer/buffer.test-tools"
import { NotificationsProvider } from "@ui/providers/notifications"
import { StatuslineProvider } from "@ui/widgets/statusline/statusline"
import { createComponent } from "solid-js"
import { mountInTui } from "../../../test/opentui-harness"
import { findRequiredNode } from "../../../test/opentui-test-tools"
import { EditorPanel } from "./editor-panel"
import type { SqlEditorSchemaState } from "./sql-editor-protocol"
import type { EditorPaneViewModel } from "./view-model/create-vm"

function getBufferLineNumber(app: Awaited<ReturnType<typeof mountInTui>>) {
  return findRequiredNode(
    app,
    (node): node is LineNumberRenderable => node instanceof LineNumberRenderable,
    "Buffer line number was not rendered",
  )
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

function hasHighlightedLines(textarea: TextareaRenderable, lines: number[]) {
  return getHighlightedLines(textarea).join(",") === lines.join(",")
}

function createViewModel(text: string): EditorPaneViewModel {
  const nodes: Node[] = [
    {
      id: "db",
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
  const schemaState: SqlEditorSchemaState = {
    rootIds: ["db"],
    nodesById: Object.fromEntries(nodes.map((node) => [node.id, node])),
    loading: false,
    loaded: true,
  }

  return {
    queryText: () => text,
    currentJob: () => undefined,
    isExecuting: () => false,
    filePath: () => "/tmp/query.sql",
    getSchemaState: () => schemaState,
    onQueryChange: () => {},
    executeQuery: async () => {},
    cancelQuery: async () => {},
    saveQuery: () => true,
    isFocused: () => true,
    focusSelf: () => {},
    unfocus: () => {},
  }
}

describe("editor panel integration", () => {
  test("updates gutter markers and highlights immediately after inserting two statements", async () => {
    const initialText = "select * from authors;"
    const insertedText = "\nselect * from books;\nselect * from categories;"
    const expectedText = `${initialText}${insertedText}`
    const visibleStatementLines = [0, 1, 2]
    const viewModel = createViewModel(initialText)
    const app = await mountInTui(
      () =>
        createComponent(NotificationsProvider, {
          get children() {
            return createComponent(StatuslineProvider, {
              resourceName: "test",
              get children() {
                return createComponent(EditorPanel, { viewModel })
              },
            })
          },
        }),
      { width: 100, height: 12 },
    )

    try {
      const textarea = getBufferTextarea(app)
      const lineNumber = getBufferLineNumber(app)

      textarea.focus()
      await moveCursor(app, textarea, 0, -1)

      await app.setup.mockInput.pasteBracketedText(insertedText)
      await app.waitFor(() => textarea.plainText === expectedText)
      await app.waitFor(() => hasHighlightedLines(textarea, visibleStatementLines))
      await app.waitFor(() => lineNumber.getLineSigns().size === 3)

      const signs = lineNumber.getLineSigns()

      expect(signs.get(0)?.before).toBe("• ")
      expect(signs.get(1)?.before).toBe("• ")
      expect(signs.get(2)?.before).toBe("󰻃 ")
      expect(getHighlightedLines(textarea)).toEqual(visibleStatementLines)
    } finally {
      app.destroy()
    }
  })
})
