import { describe, expect, test } from "bun:test"
import { ScrollBoxRenderable } from "@opentui/core"
import { getBufferTextarea } from "@test/buffer"
import { mountInTui } from "@test/opentui-harness"
import { findRequiredNode } from "@test/opentui-test-tools"
import { SelectionTestRoot } from "@test/selection-test-root"
import { Buffer } from "@ui/components/buffer/buffer"
import { OriTable, type OriTableColors } from "@ui/components/ori-table/ori-table"
import { TableCellRenderable } from "@ui/components/ori-table/table-cell"
import { KeyScope } from "@ui/services/key-scopes"
import { createSignal } from "solid-js"

const colors = {
  background: "#111111",
  alternateRowBackground: "#181818",
  headerBackground: "#222222",
  headerText: "#ffffff",
  rowNumber: "#888888",
  cursorRowNumber: "#ffffff",
  border: "#555555",
  cursorBackground: "#444444",
  cursorForeground: "#ffffff",
  text: "#dddddd",
  selectionBackground: "#666666",
} satisfies OriTableColors

function hasVisibleTableSelection(app: Awaited<ReturnType<typeof mountInTui>>) {
  return Boolean(
    app.find((node): node is TableCellRenderable => node instanceof TableCellRenderable && node.hasSelection()),
  )
}

describe("selection ownership", () => {
  test("allows a textarea outside the table to receive input after a settled table selection", async () => {
    let executed = 0
    const [focused, setFocused] = createSignal<"textarea" | "table">("table")
    const app = await mountInTui(
      () => (
        <SelectionTestRoot>
          <box
            flexDirection="column"
            width={48}
          >
            <box height={3}>
              <KeyScope
                enabled={() => focused() === "textarea"}
                bindings={[
                  {
                    pattern: "enter",
                    mode: "leader",
                    handler: () => {
                      executed += 1
                    },
                    preventDefault: true,
                  },
                ]}
              >
                <Buffer
                  initialText="select 1;"
                  isFocused={() => focused() === "textarea"}
                  onTextChange={() => {}}
                  focusSelf={() => setFocused("textarea")}
                />
              </KeyScope>
            </box>
            <OriTable
              columns={[{ name: "name" }, { name: "value" }]}
              rows={[
                ["alpha", "one"],
                ["beta", "two"],
                ["gamma", "three"],
                ["delta", "four"],
              ]}
              colors={colors}
              isFocused={() => focused() === "table"}
              focusSelf={() => setFocused("table")}
            />
          </box>
        </SelectionTestRoot>
      ),
      { width: 48, height: 10 },
    )

    try {
      const textarea = getBufferTextarea(app)
      const scrollbox = findRequiredNode(
        app,
        (node): node is ScrollBoxRenderable =>
          node instanceof ScrollBoxRenderable && node.viewport.y > textarea.y + textarea.height,
        "Table scrollbox was not rendered below the textarea",
      )
      const x = scrollbox.viewport.x + 2
      const y = scrollbox.viewport.y + 1
      await app.setup.mockMouse.pressDown(x, y)
      await app.setup.mockMouse.moveTo(x + 8, y + 1)
      await app.setup.mockMouse.release(x + 8, y + 1)
      await app.waitFor(() => hasVisibleTableSelection(app))

      await app.setup.mockMouse.click(textarea.x + 2, textarea.y)
      await app.waitFor(
        () => focused() === "textarea" && textarea.focused && app.setup.renderer.currentFocusedRenderable === textarea,
      )

      const before = textarea.plainText
      app.setup.mockInput.pressKey("j")
      await app.waitFor(() => textarea.plainText.length === before.length + 1)
      expect(textarea.plainText).toContain("j")

      app.setup.mockInput.pressKey("x", { ctrl: true })
      app.setup.mockInput.pressEnter()
      await app.waitFor(() => executed === 1)
    } finally {
      app.destroy()
    }
  })
})
