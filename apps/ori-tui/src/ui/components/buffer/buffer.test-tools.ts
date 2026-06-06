import { ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import { useLogger } from "@ui/providers/logger"
import { useTheme } from "@ui/providers/theme"
import { createSqlAnalysis } from "@ui/widgets/editor-panel/sql-analysis"
import { createComponent, onCleanup } from "solid-js"
import { type MountedTuiApp, mountInTui } from "../../../test/opentui-harness"
import { findRequiredNode, requirePresent } from "../../../test/opentui-test-tools"
import type { BufferAutocompleteProvider } from "./autocomplete/types"
import { Buffer, type BufferApi, type BufferState } from "./buffer"
import type { BufferExtension } from "./extension"
import { type BufferStatementDetector, createStatementsExtension } from "./extensions/statements"
import { createSyntaxHighlightsExtension, type SyntaxHighlightsOptions } from "./extensions/syntax-highlights"

export type BufferTestLanguage = BufferStatementDetector &
  Pick<SyntaxHighlightsOptions, "syntaxStyle" | "highlightText" | "onHighlightError">

type MountBufferOptions = {
  text?: string
  width: number
  height: number
  autocomplete?: BufferAutocompleteProvider
  language?: BufferTestLanguage
  extensions?: readonly BufferExtension[]
  onStateChange?: (state: BufferState) => void
  focusSelf?: () => void
}

export type MountedBufferWithApi = {
  app: MountedTuiApp
  api: BufferApi
}

function renderBuffer(options: MountBufferOptions, registerApi?: (api: BufferApi) => void) {
  return mountInTui(
    () =>
      createComponent(() => {
        const { theme } = useTheme()
        const logger = useLogger()
        const ownedAnalysis =
          options.language || options.extensions
            ? undefined
            : createSqlAnalysis({
                theme,
                logger,
              })
        const language =
          options.language ??
          (ownedAnalysis
            ? {
                ...ownedAnalysis.detector,
                syntaxStyle: ownedAnalysis.syntaxStyle,
                highlightText: ownedAnalysis.highlightText,
                onHighlightError: ownedAnalysis.onHighlightError,
              }
            : undefined)
        const statementsExtension = language ? createStatementsExtension(language) : undefined
        const extensions =
          options.extensions ??
          (statementsExtension && language
            ? [
                statementsExtension.extension,
                createSyntaxHighlightsExtension({
                  id: `${language.id}-highlights`,
                  statements: statementsExtension.source,
                  syntaxStyle: language.syntaxStyle,
                  highlightText: language.highlightText,
                  onHighlightError: language.onHighlightError,
                }),
              ]
            : [])

        onCleanup(() => {
          ownedAnalysis?.dispose()
        })

        return createComponent(Buffer, {
          initialText: options.text ?? "",
          isFocused: () => true,
          onTextChange: () => {},
          focusSelf: options.focusSelf ?? (() => {}),
          onStateChange: options.onStateChange,
          autocomplete: options.autocomplete,
          extensions,
          registerApi,
        })
      }, {}),
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

export async function mountText(mounted: MountedBufferWithApi, textarea: TextareaRenderable, text: string) {
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
  await app.waitFor(() => textarea.logicalCursor.row === targetRow && textarea.logicalCursor.col === targetCol)
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
