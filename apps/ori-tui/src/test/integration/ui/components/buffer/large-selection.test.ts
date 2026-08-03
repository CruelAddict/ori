import { expect, test } from "bun:test"
import { getBufferTextarea, mountBuffer } from "@test/buffer"

test("reads an editor selection beyond OpenTUI's fixed limit", async () => {
  const text = `${"a".repeat(1024 * 1024)}selection-tail`
  const app = await mountBuffer({ text, width: 40, height: 6, extensions: [] })

  try {
    const textarea = getBufferTextarea(app)
    textarea.editorView.setSelection(0, text.length)

    expect(textarea.editorView.getSelectedText()).toBe(text)
  } finally {
    app.destroy()
  }
})
