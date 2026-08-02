import { describe, expect, test } from "bun:test"
import { getBufferTextarea, moveCursor } from "@test/buffer"
import { mountInTui } from "@test/opentui-harness"
import { SelectionTestRoot } from "@test/selection-test-root"
import { Buffer } from "@ui/components/buffer/buffer"
import { type SelectionAction, useSelection } from "@ui/providers/selection"
import { createEffect } from "solid-js"

function SelectionState(props: { onChange: (actions: readonly SelectionAction[]) => void }) {
  const selection = useSelection()
  createEffect(() => props.onChange(selection.actions()))
  return null
}

describe("buffer root selection finalizer", () => {
  test("keeps the native editor range until an editor action clears it", async () => {
    let actions: readonly SelectionAction[] = []
    const app = await mountInTui(
      () => (
        <SelectionTestRoot>
          <SelectionState
            onChange={(value) => {
              actions = value
            }}
          />
          <box width={40}>
            <Buffer
              initialText="select 1"
              isFocused={() => true}
              onTextChange={() => {}}
              focusSelf={() => {}}
            />
          </box>
        </SelectionTestRoot>
      ),
      { width: 40, height: 6 },
    )

    try {
      const textarea = getBufferTextarea(app)
      await app.setup.mockMouse.pressDown(textarea.x + 1, textarea.y)
      await app.setup.mockMouse.moveTo(textarea.x + 4, textarea.y)
      await app.setup.mockMouse.release(textarea.x + 4, textarea.y)

      await app.waitFor(() => textarea.hasSelection() && !app.setup.renderer.getSelection()?.isDragging)
      expect(textarea.getSelectedText().length).toBeGreaterThan(0)
      expect(app.setup.renderer.getSelection()?.isActive).toBe(true)
      expect(actions.map((action) => action.key)).toEqual(["ctrl+y", "ctrl+k", "backspace"])

      actions.find((action) => action.key === "backspace")?.run()
      await app.waitFor(() => !textarea.hasSelection() && !app.setup.renderer.getSelection()?.isActive)
    } finally {
      app.destroy()
    }
  })

  test("stops textarea live selection when mouse is released outside the buffer", async () => {
    const text = `${Array.from({ length: 200 }, (_, i) => `line-${i}`).join("\n")}\n`
    const app = await mountInTui(
      () => (
        <SelectionTestRoot>
          <box width={40}>
            <Buffer
              initialText={text}
              isFocused={() => true}
              onTextChange={() => {}}
              focusSelf={() => {}}
            />
          </box>
          <box width={12}>
            <text>outside</text>
          </box>
        </SelectionTestRoot>
      ),
      { width: 52, height: 8 },
    )

    try {
      const textarea = getBufferTextarea(app)

      await moveCursor(app, textarea, 120, 0)
      await app.waitFor(() => textarea.scrollY > 0)
      const topBeforeDrag = textarea.scrollY

      await app.setup.mockMouse.pressDown(textarea.x + 1, textarea.y + 5)
      await app.setup.mockMouse.moveTo(textarea.x + 1, textarea.y)
      await app.waitFor(() => textarea.live && textarea.scrollY < topBeforeDrag)

      await app.setup.mockMouse.release(textarea.x + textarea.width + 4, textarea.y)
      await app.waitFor(() => !textarea.live)
      await app.waitFor(() => !app.setup.renderer.getSelection()?.isDragging)

      expect(textarea.showCursor).toBe(true)
    } finally {
      app.destroy()
    }
  })
})
