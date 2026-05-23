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
    subscribeSchemaState: () => () => {},
    onQueryChange: () => { },
    executeQuery: async () => { },
    cancelQuery: async () => { },
    saveQuery: () => true,
    isFocused: () => true,
    focusSelf: () => { },
    unfocus: () => { },
  }
}

function createLargeSqlPasteFixture() {
  const fillerLine = `-- ${"x".repeat(240)}`
  const fillerCount = 4300
  const tail = `ALTER TABLE LinkTable
	ADD CONSTRAINT [PK_LinkTable] PRIMARY KEY  NONCLUSTERED
	(
		[OwnerID],
		[GroupID]
	) ON [PRIMARY]
GO
ALTER TABLE LinkTable
	ADD CONSTRAINT [FK_LinkTable_ParentTable] FOREIGN KEY
	(
		[OwnerID]
	) REFERENCES [dbo].[ParentTable] (
		[OwnerID]
	)
GO
ALTER TABLE LinkTable	
	ADD CONSTRAINT [FK_LinkTable_GroupTable] FOREIGN KEY
	(
		[GroupID]
	) REFERENCES [dbo].[GroupTable] (
		[GroupID]
	)`
  const text = `${Array.from({ length: fillerCount }, () => fillerLine).join("\n")}\n${tail}`
  const tailStatementStartLines = tail
    .split("\n")
    .flatMap((line, index) => (line.startsWith("ALTER TABLE") ? [fillerCount + index] : []))

  return {
    text,
    tail,
    tailStatementStartLines,
  }
}

function createLargeInsertViewportFixture() {
  const fillerLine = `-- ${"x".repeat(240)}`
  const fillerCount = 4300
  const insertLines = createInsertHighlightLines(false)
  const text = `${Array.from({ length: fillerCount }, () => fillerLine).join("\n")}\n${insertLines.join("\n")}`

  return {
    text,
    insertLines,
    fillerCount,
  }
}

function createInsertHighlightLines(includeSemicolons: boolean) {
  const firstBlock = [
    [1, "alpha"],
    [2, "bravo"],
    [3, "charlie"],
    [4, "delta"],
  ]
  const secondBlock = [
    ["00001", "alpha", 1],
    ["00002", "bravo", 1],
    ["00003", "charlie", 1],
    ["00004", "delta", 1],
    ["00005", "echo", 1],
    ["00006", "foxtrot", 1],
    ["00007", "golf", 1],
    ["00008", "hotel", 3],
    ["00009", "india", 3],
    ["00010", "juliet", 1],
    ["00011", "kilo", 1],
    ["00012", "lima", 1],
    ["00013", "mike", 1],
    ["00014", "november", 1],
    ["00015", "oscar", 3],
    ["00016", "papa", 1],
    ["00017", "quebec", 1],
    ["00018", "romeo", 1],
    ["00019", "sierra", 1],
    ["00020", "tango", 1],
  ]

  return [
    ...firstBlock.map(([id, label]) => `Insert Into GroupRows Values (${id},'${label}')${includeSemicolons ? ";" : ""}`),
    ...secondBlock.map(([id, label, groupId], index) =>
      `Insert Into ItemRows Values ('${id}','${label}',${groupId})${includeSemicolons && index < 5 ? ";" : ""}`,
    ),
  ]
}

function createInsertPasteSnippet(lineBreak: "lf" | "crlf") {
  return createInsertHighlightLines(true).join(lineBreak === "crlf" ? "\r\n" : "\n")
}

function createMultilineInsertSnippet() {
  return `INSERT INTO "Records"
("Id","Code","Label")
VALUES (1,N'alpha',N'one')
INSERT INTO "Records"
("Id","Code","Label")
VALUES (2,N'beta',N'two')
INSERT INTO "Records"
("Id","Code","Label")
VALUES (3,N'gamma',N'three' `
}

function expectedInsertSnippetHighlightCounts() {
  return [10, 10, 10, 10, 12, 12, 12, 12, 12, ...Array.from({ length: 15 }, () => 11)]
}

function expectRenderedInsertKeywordHighlight(app: Awaited<ReturnType<typeof mountInTui>>) {
  const renderedLine = app.setup
    .captureSpans()
    .lines.find((line) => line.spans.map((span) => span.text).join("").includes("'00007'"))

  expect(renderedLine).toBeDefined()

  const insertSpan = renderedLine?.spans.find((span) => span.text.includes("Insert"))
  const intoSpan = renderedLine?.spans.find((span) => span.text.includes("Into"))

  expect(insertSpan).toBeDefined()
  expect(intoSpan).toBeDefined()
  expect(insertSpan?.fg).toEqual(intoSpan?.fg)
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

  test("splits standalone GO batches into separate statements after paste", async () => {
    const insertedText = `if exists (select 1)
drop procedure old_proc
GO
ALTER TABLE link_table
ADD PRIMARY KEY (
  owner_id,
  group_id
)
GO
ALTER TABLE link_table
ADD FOREIGN KEY (
  group_id
) REFERENCES group_table (
  group_id
)`
    const viewModel = createViewModel("")
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
      { width: 100, height: 20 },
    )

    try {
      const textarea = getBufferTextarea(app)
      const lineNumber = getBufferLineNumber(app)

      textarea.focus()
      await app.setup.mockInput.pasteBracketedText(insertedText)
      await app.waitFor(() => textarea.plainText === insertedText)
      await app.waitFor(() => lineNumber.getLineSigns().size === 3)

      const signs = lineNumber.getLineSigns()

      expect(signs.get(0)?.before).toBe("• ")
      expect(signs.get(3)?.before).toBe("• ")
      expect(signs.get(9)?.before).toBe("󰻃 ")
    } finally {
      app.destroy()
    }
  })

  test("keeps full pasted SQL larger than 1 MiB and resolves tail statements", async () => {
    const fixture = createLargeSqlPasteFixture()
    const lastStatementStartLine = fixture.tailStatementStartLines[fixture.tailStatementStartLines.length - 1] ?? -1
    const middleStatementStartLine = fixture.tailStatementStartLines[1] ?? -1
    const firstStatementStartLine = fixture.tailStatementStartLines[0] ?? -1
    const viewModel = createViewModel("")
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
      { width: 100, height: 20, targetFps: 240 },
    )

    try {
      const textarea = getBufferTextarea(app)
      const lineNumber = getBufferLineNumber(app)

      expect(fixture.text.length).toBeGreaterThan(1024 * 1024)

      textarea.focus()
      await app.setup.mockInput.pasteBracketedText(fixture.text)
      await app.waitFor(() => textarea.plainText === fixture.text, 20_000)
      await app.waitFor(() => lineNumber.getLineSigns().size === fixture.tailStatementStartLines.length, 20_000)

      await moveCursor(app, textarea, lastStatementStartLine, 0)
      await app.waitFor(() => textarea.logicalCursor.row === lastStatementStartLine, 5_000)
      await app.waitFor(() => lineNumber.getLineSigns().get(lastStatementStartLine)?.before === "󰻃 ", 5_000)
      await app.waitFor(() => textarea.getLineHighlights(lastStatementStartLine).length > 0, 5_000)

      const signs = lineNumber.getLineSigns()

      expect(signs.get(firstStatementStartLine)?.before).toBe("• ")
      expect(signs.get(middleStatementStartLine)?.before).toBe("• ")
      expect(signs.get(lastStatementStartLine)?.before).toBe("󰻃 ")
      expect(textarea.plainText.slice(-fixture.tail.length)).toBe(fixture.tail)
    } finally {
      app.destroy()
    }
  }, 30_000)

  test("highlights every visible insert statement after large paste and scroll", async () => {
    const fixture = createLargeInsertViewportFixture()
    const firstHeaderLine = fixture.fillerCount
    const firstItemLine = fixture.fillerCount + 4
    const lastItemLine = fixture.fillerCount + fixture.insertLines.length - 1
    const viewModel = createViewModel("")
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
      { width: 100, height: 20, targetFps: 240 },
    )

    try {
      const textarea = getBufferTextarea(app)
      const lineNumber = getBufferLineNumber(app)

      textarea.focus()
      await app.setup.mockInput.pasteBracketedText(fixture.text)
      await app.waitFor(() => textarea.plainText === fixture.text, 20_000)
      await app.waitFor(() => lineNumber.getLineSigns().size === fixture.insertLines.length, 20_000)

      await moveCursor(app, textarea, firstItemLine + 2, 0)
      await app.waitFor(() => textarea.logicalCursor.row === firstItemLine + 2, 5_000)
      await app.waitFor(() => textarea.getLineHighlights(firstHeaderLine).length > 0, 5_000)

      const headerLines = Array.from({ length: 4 }, (_, index) => firstHeaderLine + index)
      const itemLines = Array.from({ length: lastItemLine - firstItemLine + 1 }, (_, index) => firstItemLine + index)

      expect(headerLines.every((line) => textarea.getLineHighlights(line).length > 0)).toBe(true)
      expect(itemLines.every((line) => textarea.getLineHighlights(line).length > 0)).toBe(true)
    } finally {
      app.destroy()
    }
  }, 30_000)

  test("highlights all pasted insert lines in empty buffer (lf)", async () => {
    const insertedText = createInsertPasteSnippet("lf")
    const viewModel = createViewModel("")
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
      { width: 120, height: 30, targetFps: 240 },
    )

    try {
      const textarea = getBufferTextarea(app)

      textarea.focus()
      await app.setup.mockInput.pasteBracketedText(insertedText)
      await app.waitFor(() => textarea.plainText === insertedText, 10_000)
      await app.waitFor(() => textarea.getLineHighlights(23).length > 0, 10_000)

      const counts = Array.from({ length: 24 }, (_, index) => textarea.getLineHighlights(index).length)

      expect(counts).toEqual(expectedInsertSnippetHighlightCounts())
      expectRenderedInsertKeywordHighlight(app)
    } finally {
      app.destroy()
    }
  }, 30_000)

  test("highlights all pasted insert lines in empty buffer (crlf)", async () => {
    const insertedText = createInsertPasteSnippet("crlf")
    const viewModel = createViewModel("")
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
      { width: 120, height: 30, targetFps: 240 },
    )

    try {
      const textarea = getBufferTextarea(app)

      textarea.focus()
      await app.setup.mockInput.pasteBracketedText(insertedText)
      await app.waitFor(() => textarea.plainText.length > 0, 10_000)
      const normalizedText = insertedText.replaceAll("\r\n", "\n")
      if (textarea.plainText !== normalizedText) {
        throw new Error(
          JSON.stringify(
            {
              lineBreak: "crlf",
              expectedLength: normalizedText.length,
              actualLength: textarea.plainText.length,
              expectedTail: normalizedText.slice(-120),
              actualTail: textarea.plainText.slice(-120),
            },
            null,
            2,
          ),
        )
      }
      await app.waitFor(() => textarea.getLineHighlights(0).length > 0, 10_000)

      const counts = Array.from({ length: 24 }, (_, index) => textarea.getLineHighlights(index).length)

      expect(counts).toEqual(expectedInsertSnippetHighlightCounts())
      expectRenderedInsertKeywordHighlight(app)
    } finally {
      app.destroy()
    }
  }, 30_000)

  test("keeps three multiline inserts as separate gutter statements without semicolons", async () => {
    const insertedText = createMultilineInsertSnippet()
    const viewModel = createViewModel("")
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
      { width: 120, height: 40, targetFps: 240 },
    )

    try {
      const textarea = getBufferTextarea(app)
      const lineNumber = getBufferLineNumber(app)

      textarea.focus()
      await app.setup.mockInput.pasteBracketedText(insertedText)
      await app.waitFor(() => textarea.plainText === insertedText, 10_000)
      await app.waitFor(() => lineNumber.getLineSigns().size === 3, 10_000)

      const signs = lineNumber.getLineSigns()

      expect(signs.get(0)?.before).toBe("• ")
      expect(signs.get(3)?.before).toBe("• ")
      expect(signs.get(6)?.before).toBe("󰻃 ")
    } finally {
      app.destroy()
    }
  }, 30_000)

})
