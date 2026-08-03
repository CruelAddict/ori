import { describe, expect, test } from "bun:test"
import { getBufferScrollbox, getBufferTextarea, mountBuffer, moveCursor } from "@test/buffer"
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

  test("keeps the document anchor when drag autoscroll leaves the terminal", async () => {
    const text = Array.from({ length: 200 }, (_, index) => `line-${index.toString().padStart(3, "0")}`).join("\n")
    const app = await mountBuffer({ text, width: 40, height: 8 })

    try {
      const textarea = getBufferTextarea(app)
      const scrollbox = getBufferScrollbox(app)

      await moveCursor(app, textarea, 120, 0)
      await app.waitFor(() => textarea.scrollY > 4)
      const topBeforeDrag = textarea.scrollY
      const x = textarea.x + 4

      await app.setup.mockMouse.pressDown(x, textarea.y + 5)
      await app.setup.mockMouse.moveTo(x, textarea.y + 4)
      await app.waitFor(() => textarea.editorView.getSelection() !== null)
      const initial = textarea.editorView.getSelection()
      if (!initial) {
        throw new Error("Initial editor selection was not created")
      }

      await app.setup.mockMouse.moveTo(x, textarea.y)
      await app.setup.mockMouse.moveTo(x, -1)
      await app.waitFor(() => textarea.scrollY <= topBeforeDrag - 4)

      const scrolled = textarea.editorView.getSelection()
      if (!scrolled) {
        throw new Error("Editor selection was lost during drag autoscroll")
      }
      expect(scrollbox.live).toBe(false)
      expect(textarea.live).toBe(true)
      expect(scrolled.end).toBe(initial.end)
      expect(textarea.getSelectedText()).toBe(text.slice(scrolled.start, scrolled.end))

      await app.setup.mockMouse.release(x, textarea.y)
      await app.waitFor(() => app.setup.renderer.getSelection()?.isDragging === false)
      const settled = textarea.editorView.getSelection()
      const topAfterDrag = textarea.scrollY

      await app.setup.mockMouse.scroll(x, textarea.y + 1, "down")
      await app.waitFor(() => textarea.scrollY > topAfterDrag)

      expect(textarea.editorView.getSelection()).toEqual(settled)
    } finally {
      app.destroy()
    }
  })
})
