import { describe, expect, test } from "bun:test"
import { getBufferTextarea } from "@test/buffer"
import { mountInTui } from "@test/opentui-harness"
import { SelectionTestRoot } from "@test/selection-test-root"
import { Buffer } from "@ui/components/buffer/buffer"
import { type SelectionAction, useSelection } from "@ui/providers/selection"
import { SelectionHotkeys } from "@ui/selection/selection-hotkeys"
import { createEffect } from "solid-js"

function SelectionState(props: { onChange: (actions: readonly SelectionAction[]) => void }) {
  const selection = useSelection()
  createEffect(() => props.onChange(selection.actions()))
  return null
}

describe("selection escape hotkey", () => {
  test("registers a keyboard editor range with selection actions", async () => {
    let actions: readonly SelectionAction[] = []
    const app = await mountInTui(
      () => (
        <SelectionTestRoot>
          <SelectionHotkeys />
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

      app.setup.mockInput.pressArrow("right", { shift: true })
      await app.waitFor(() => textarea.hasSelection() && actions.length > 0)

      expect(textarea.getSelectedText()).toBe("s")
      expect(actions.map((action) => action.key)).toEqual(["ctrl+y", "ctrl+k", "backspace"])

      app.setup.mockInput.pressArrow("right")
      await app.waitFor(() => actions.length === 0 && !textarea.hasSelection())
    } finally {
      app.destroy()
    }
  })

  test("deletes the current editor range before mouseup", async () => {
    const initialText = "abcdefghij"
    const app = await mountInTui(
      () => (
        <SelectionTestRoot>
          <SelectionHotkeys />
          <box width={40}>
            <Buffer
              initialText={initialText}
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
      await app.waitFor(() => textarea.hasSelection() && app.setup.renderer.getSelection()?.isDragging === true)
      const selected = textarea.getSelectedText()

      app.setup.mockInput.pressBackspace()
      await app.waitFor(() => !textarea.hasSelection() && app.setup.renderer.getSelection() === null)

      expect(selected.length).toBeGreaterThan(0)
      expect(textarea.plainText).toBe(initialText.replace(selected, ""))

      await app.setup.mockMouse.release(textarea.x + 4, textarea.y)
      expect(app.setup.renderer.getSelection()).toBeNull()
    } finally {
      app.destroy()
    }
  })

  test("cancels an active drag before it reaches the editor", async () => {
    let unfocused = 0
    const app = await mountInTui(
      () => (
        <SelectionTestRoot>
          <SelectionHotkeys />
          <box width={40}>
            <Buffer
              initialText="select 1"
              isFocused={() => true}
              onTextChange={() => {}}
              onUnfocus={() => {
                unfocused += 1
              }}
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
      await app.waitFor(() => app.setup.renderer.getSelection()?.isDragging === true)

      app.setup.mockInput.pressEscape()
      await app.waitFor(() => app.setup.renderer.getSelection() === null)

      expect(textarea.hasSelection()).toBe(false)
      expect(unfocused).toBe(0)
    } finally {
      app.destroy()
    }
  })

  test("clears a retained selection before returning escape to the editor", async () => {
    let unfocused = 0
    const app = await mountInTui(
      () => (
        <SelectionTestRoot>
          <SelectionHotkeys />
          <box width={40}>
            <Buffer
              initialText="select 1"
              isFocused={() => true}
              onTextChange={() => {}}
              onUnfocus={() => {
                unfocused += 1
              }}
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
      await app.waitFor(() => textarea.hasSelection() && app.setup.renderer.getSelection()?.isActive === true)

      app.setup.mockInput.pressEscape()
      await app.waitFor(() => !textarea.hasSelection() && app.setup.renderer.getSelection() === null)

      expect(unfocused).toBe(0)

      app.setup.mockInput.pressEscape()
      await app.waitFor(() => unfocused === 1)
    } finally {
      app.destroy()
    }
  })

  test("clears selection actions when cursor movement collapses an editor range", async () => {
    let actions: readonly SelectionAction[] = []
    let unfocused = 0
    const app = await mountInTui(
      () => (
        <SelectionTestRoot>
          <SelectionHotkeys />
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
              onUnfocus={() => {
                unfocused += 1
              }}
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
      await app.waitFor(() => actions.map((action) => action.key).join(",") === "ctrl+y,ctrl+k,backspace")

      app.setup.mockInput.pressArrow("right")
      await app.waitFor(() => actions.length === 0 && !textarea.hasSelection())

      app.setup.mockInput.pressEscape()
      await app.waitFor(() => unfocused === 1)
    } finally {
      app.destroy()
    }
  })
})
