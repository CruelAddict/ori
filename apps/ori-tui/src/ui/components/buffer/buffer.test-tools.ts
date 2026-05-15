import { ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import { createComponent } from "solid-js"
import { findRequiredNode, requirePresent } from "../../../test/opentui-test-tools"
import { mountInTui, type MountedTuiApp } from "../../../test/opentui-harness"
import { Buffer, type BufferApi, type BufferContext } from "./buffer"
import type { BufferAutocompleteProvider } from "./autocomplete/types"

type MountBufferOptions = {
  text?: string
  width: number
  height: number
  autocomplete?: BufferAutocompleteProvider
  onContextChange?: (context: BufferContext) => void
}

export type MountedBufferWithApi = {
  app: MountedTuiApp
  api: BufferApi
}

function renderBuffer(options: MountBufferOptions, registerApi?: (api: BufferApi) => void) {
  return mountInTui(
    () =>
      createComponent(Buffer, {
        initialText: options.text ?? "",
        language: "sql",
        isFocused: () => true,
        onTextChange: () => { },
        focusSelf: () => { },
        onContextChange: options.onContextChange,
        autocomplete: options.autocomplete,
        registerApi,
      }),
    { width: options.width, height: options.height },
  )
}

export function mountBuffer(options: MountBufferOptions) {
  return renderBuffer(options)
}

export async function mountBufferWithApi(options: MountBufferOptions): Promise<MountedBufferWithApi> {
  let api: BufferApi | undefined
  const app = await renderBuffer(options, (next) => {
    api = next
  })

  return {
    app,
    api: requirePresent(api, "Buffer api was not registered"),
  }
}

export async function mountText(
  mounted: MountedBufferWithApi,
  textarea: TextareaRenderable,
  text: string,
) {
  mounted.api.setText(text)
  await mounted.app.waitFor(() => textarea.plainText === text)
}

export async function moveCursor(app: MountedTuiApp, textarea: TextareaRenderable, row: number, col: number) {
  const lines = textarea.plainText.split("\n")
  const targetRow = row === -1 ? Math.max(0, lines.length - 1) : row
  const line = lines[targetRow] ?? ""
  const targetCol = col === -1 ? line.length : col

  textarea.gotoLine(targetRow)
  await app.waitFor(() => textarea.logicalCursor.row === targetRow)
  if (col === -1) {
    textarea.gotoLineEnd()
  }
  if (col !== -1) {
    textarea.editBuffer.setCursor(targetRow, targetCol)
    textarea.requestRender()
  }
  await app.waitFor(
    () => textarea.logicalCursor.row === targetRow && textarea.logicalCursor.col === targetCol,
  )
}

export function getBufferTextarea(app: MountedTuiApp) {
  return findRequiredNode(
    app,
    (node): node is TextareaRenderable => node instanceof TextareaRenderable,
    "Buffer textarea was not rendered",
  )
}

export function getBufferScrollbox(app: MountedTuiApp) {
  return findRequiredNode(
    app,
    (node): node is ScrollBoxRenderable => node instanceof ScrollBoxRenderable,
    "Buffer scrollbox was not rendered",
  )
}
