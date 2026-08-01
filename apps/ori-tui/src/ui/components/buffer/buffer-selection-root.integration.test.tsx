import { describe, expect, test } from "bun:test"
import { type AppSelection, useActiveSelectionOwner } from "@ui/selection/selection-lock"
import { createEffect } from "solid-js"
import { mountInTui } from "../../../test/opentui-harness"
import { SelectionControllerTestRoot } from "../../../test/selection-controller-test-root"
import { Buffer } from "./buffer"
import { getBufferTextarea, moveCursor } from "./buffer.test-tools"

function SelectionState(props: { onChange: (selection: AppSelection | undefined) => void }) {
  const selection = useActiveSelectionOwner()
  createEffect(() => props.onChange(selection.selection()))
  return null
}

describe("buffer root selection finalizer", () => {
  test("retains the editor-local range with editor shortcuts after native selection settles", async () => {
    let retained: AppSelection | undefined
    const app = await mountInTui(
      () => (
        <SelectionControllerTestRoot>
          <SelectionState
            onChange={(selection) => {
              retained = selection
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
        </SelectionControllerTestRoot>
      ),
      { width: 40, height: 6 },
    )

    try {
      const textarea = getBufferTextarea(app)
      await app.setup.mockMouse.pressDown(textarea.x + 1, textarea.y)
      await app.setup.mockMouse.moveTo(textarea.x + 4, textarea.y)
      await app.setup.mockMouse.release(textarea.x + 4, textarea.y)

      await app.waitFor(() => textarea.hasSelection() && !app.setup.renderer.getSelection()?.isActive)
      expect(textarea.getSelectedText().length).toBeGreaterThan(0)
      expect(retained?.actions.map((action) => action.key)).toEqual(["ctrl+y", "ctrl+k", "backspace"])
    } finally {
      app.destroy()
    }
  })

  test("stops textarea live selection when mouse is released outside the buffer", async () => {
    const text = `${Array.from({ length: 200 }, (_, i) => `line-${i}`).join("\n")}\n`
    const app = await mountInTui(
      () => (
        <SelectionControllerTestRoot>
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
        </SelectionControllerTestRoot>
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
