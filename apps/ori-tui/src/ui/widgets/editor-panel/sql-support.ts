import type { DocCharOffset } from "@ui/components/buffer/coords"
import type { BufferExtension } from "@ui/components/buffer/extension"
import { createStatementsExtension } from "@ui/components/buffer/extensions/statements"
import { createSyntaxHighlightsExtension } from "@ui/components/buffer/extensions/syntax-highlights"
import type { SyntaxThemePalette } from "@utils/syntax-highlighter"
import type { Logger } from "pino"
import type { Accessor } from "solid-js"
import {
  createSqlAnalysis,
  resolveSqlQueryAtOffset,
  type SqlAnalysisSnapshot,
  type SqlQueryResolution,
} from "./sql-analysis"
import { createSqlEditorBgWorkerAdapter } from "./sql-editor-bg-worker-adapter"
import type { SqlEditorSchemaState } from "./sql-editor-protocol"

export type SqlSupport = {
  extensions: readonly BufferExtension[]
  autocomplete: ReturnType<typeof createSqlEditorBgWorkerAdapter>["autocomplete"]
  snapshot: Accessor<SqlAnalysisSnapshot>
  resolveQueryAtOffset: (
    text: string,
    lineStarts: readonly DocCharOffset[],
    offset: DocCharOffset,
  ) => SqlQueryResolution
  dispose: () => void
}

export function createSqlSupport(options: {
  theme: Accessor<SyntaxThemePalette>
  logger: Logger
  getSchemaState: () => SqlEditorSchemaState
  subscribeSchemaState: (listener: () => void) => () => void
}): SqlSupport {
  const analysis = createSqlAnalysis({
    theme: options.theme,
    logger: options.logger,
  })
  const statementsExtension = createStatementsExtension(analysis.detector)
  const highlightsExtension = createSyntaxHighlightsExtension({
    id: "sql-highlights",
    statements: statementsExtension.source,
    syntaxStyle: analysis.syntaxStyle,
    highlightText: analysis.highlightText,
    onHighlightError: analysis.onHighlightError,
  })
  const worker = createSqlEditorBgWorkerAdapter({
    getState: options.getSchemaState,
    subscribeState: options.subscribeSchemaState,
    logger: options.logger,
  })

  return {
    extensions: [statementsExtension.extension, highlightsExtension],
    autocomplete: worker.autocomplete,
    snapshot: analysis.snapshot,
    resolveQueryAtOffset: (text, lineStarts, offset) =>
      resolveSqlQueryAtOffset(analysis.snapshot(), lineStarts, text, offset),
    dispose: () => {
      analysis.dispose()
      worker.dispose()
    },
  }
}
