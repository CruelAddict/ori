import { expect, test } from "bun:test"
import type { MouseEvent, TextRenderable } from "@opentui/core"
import { mountInTui } from "@test/opentui-harness"
import { SelectionTestRoot } from "@test/selection-test-root"
import { type SelectionAction, useSelection, useSelectionOwner } from "@ui/providers/selection"
import { createEffect, createSignal } from "solid-js"

function SelectionState(props: { onChange: (actions: readonly SelectionAction[]) => void }) {
  const selection = useSelection()
  createEffect(() => props.onChange(selection.actions()))
  return null
}

function SelectionProbe(props: { onReady: (node: TextRenderable | undefined) => void; onDragEnd: () => void }) {
  const [dragging, setDragging] = createSignal(false)
  const [selected, setSelected] = createSignal(false)
  const owner = useSelectionOwner({
    pane: "results",
    isDragging: dragging,
    readSelection: () => (selected() ? { text: "selection probe" } : undefined),
    clearSelection: () => {
      setDragging(false)
      setSelected(false)
    },
    onDragEnd: () => {
      setDragging(false)
      setSelected(true)
      props.onDragEnd()
    },
  })

  const handleMouseDown = (event: MouseEvent) => {
    if (!owner.tryAcquire()) {
      event.preventDefault()
      return
    }

    event.preventDefault()
    setDragging(true)
    setSelected(false)
  }

  return (
    /* biome-ignore lint/a11y/noStaticElementInteractions: probe starts a native selection gesture */
    <text
      ref={props.onReady}
      selectable={owner.canAcquire()}
      onMouseDown={handleMouseDown}
    >
      selection probe
    </text>
  )
}

test("settles a stale native drag on mouse move", async () => {
  let probe: TextRenderable | undefined
  let actions: readonly SelectionAction[] = []
  let dragEnds = 0
  const app = await mountInTui(
    () => (
      <SelectionTestRoot>
        <SelectionState
          onChange={(value) => {
            actions = value
          }}
        />
        <SelectionProbe
          onReady={(node) => {
            probe = node
          }}
          onDragEnd={() => {
            dragEnds += 1
          }}
        />
      </SelectionTestRoot>
    ),
    { width: 30, height: 4 },
  )

  try {
    await app.waitFor(() => probe !== undefined)
    if (!probe) {
      throw new Error("Selection probe was not rendered")
    }

    const x = probe.x + 1
    const y = probe.y
    await app.setup.mockMouse.pressDown(x, y)
    await app.setup.mockMouse.moveTo(x + 4, y)
    await app.waitFor(() => Boolean(app.setup.renderer.getSelection()?.isDragging))

    const stale = app.setup.renderer.getSelection()
    const focus = stale?.focus
    if (!stale || !focus) {
      throw new Error("Native selection was not created")
    }

    await app.setup.mockMouse.emitMouseEvent("move", x + 4, y)
    await app.waitFor(
      () =>
        !app.setup.renderer.getSelection()?.isDragging &&
        dragEnds === 1 &&
        actions.map((action) => action.key).join(",") === "y",
    )

    expect(app.setup.renderer.getSelection()).toBe(stale)
    expect(app.setup.renderer.getSelection()?.focus).toEqual(focus)

    await app.setup.mockMouse.pressDown(x + 2, y)
    await app.waitFor(
      () => app.setup.renderer.getSelection()?.isDragging === true && app.setup.renderer.getSelection() !== stale,
    )
    await app.setup.mockMouse.moveTo(x + 5, y)
    await app.setup.mockMouse.release(x + 5, y)
  } finally {
    app.destroy()
  }
})
