import { describe, expect, test } from "bun:test"
import type { AppContextValue } from "@ui/providers/app-context"
import type { AppSelection, AppSelectionAction } from "@ui/selection/selection-lock"
import type { StatuslineContext } from "@ui/widgets/statusline/statusline-types"
import { mountInTui } from "../../../../test/opentui-harness"
import { readFrameText } from "../../../../test/opentui-test-tools"
import { selectionActionsPlugin } from "./selection-actions"

function SelectionActionsTestView(props: { selection: AppSelection | undefined }) {
  const app: AppContextValue = {
    resourceViews: () => ({}),
    activeResourceView: () => undefined,
    selection: () => props.selection,
    registerResourceView: () => () => {},
  }
  const ctx: StatuslineContext = {
    app,
    now: () => 0,
    color: (value) => value,
    Text: (text) => <text selectable={false}>{text.children}</text>,
  }

  return <box flexDirection="row">{selectionActionsPlugin.render(ctx)}</box>
}

function action(key: AppSelectionAction["key"], label: AppSelectionAction["label"], run: () => void) {
  return { key, label, run } satisfies AppSelectionAction
}

describe("selection actions statusline plugin", () => {
  test("shows only the supported results action and runs it on mouse down", async () => {
    let copies = 0
    const copy = () => {
      copies += 1
    }
    const app = await mountInTui(
      () => <SelectionActionsTestView selection={{ actions: [action("y", "copy", copy)] }} />,
      { width: 30, height: 2 },
    )

    try {
      expect(readFrameText(app)).toContain("y copy")
      expect(readFrameText(app)).not.toContain("x cut")
      const control = app.setup.renderer.root.findDescendantById("selection-action-y")
      if (!control) {
        throw new Error("Missing selection copy action")
      }
      await app.setup.mockMouse.click(control.screenX, control.screenY)
      expect(copies).toBe(1)
    } finally {
      app.destroy()
    }
  })

  test("renders editor actions in contextual shortcut order", async () => {
    const app = await mountInTui(
      () => (
        <SelectionActionsTestView
          selection={{
            actions: [
              action("backspace", "delete", () => {}),
              action("ctrl+y", "copy", () => {}),
              action("ctrl+k", "cut", () => {}),
            ],
          }}
        />
      ),
      { width: 60, height: 2 },
    )

    try {
      const text = readFrameText(app)
      expect(text.indexOf("ctrl+y copy")).toBeLessThan(text.indexOf("ctrl+k cut"))
      expect(text.indexOf("ctrl+k cut")).toBeLessThan(text.indexOf("backspace delete"))
    } finally {
      app.destroy()
    }
  })
})
