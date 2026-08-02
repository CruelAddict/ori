import { describe, expect, test } from "bun:test"
import { mountInTui } from "@test/opentui-harness"
import { readFrameText } from "@test/opentui-test-tools"
import { WelcomePane } from "@ui/widgets/welcome-pane/welcome-pane"
import { createComponent, createSignal } from "solid-js"

describe("WelcomePane", () => {
  test("shows the browse hint without moving the persistent hints", async () => {
    const [canBrowseSelected, setCanBrowseSelected] = createSignal(false)
    const app = await mountInTui(() => createComponent(WelcomePane, { canBrowseSelected }), { width: 80, height: 20 })

    try {
      expect(readFrameText(app)).not.toContain("view table content")
      const initialLine = findLine(app, "search introspection results")

      setCanBrowseSelected(true)
      await app.renderOnce()
      expect(readFrameText(app)).toContain("ctrl+x enter")
      expect(readFrameText(app)).toContain("view table content")
      expect(findLine(app, "search introspection results")).toBe(initialLine)

      setCanBrowseSelected(false)
      await app.renderOnce()
      expect(readFrameText(app)).not.toContain("view table content")
    } finally {
      app.destroy()
    }
  })
})

function findLine(app: Parameters<typeof readFrameText>[0], text: string) {
  const line = app.setup.captureSpans().lines.findIndex((line) => line.spans.some((span) => span.text.includes(text)))
  if (line < 0) {
    throw new Error(`Missing text: ${text}`)
  }
  return line
}
