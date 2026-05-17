import type { BufferAnalysis } from "@ui/components/buffer/analysis"
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
  analysis: BufferAnalysis
  autocomplete: ReturnType<typeof createSqlEditorBgWorkerAdapter>["autocomplete"]
  snapshot: Accessor<SqlAnalysisSnapshot>
  resolveQueryAtOffset: (text: string, lineStarts: readonly number[], offset: number) => SqlQueryResolution
  dispose: () => void
}

export function createSqlSupport(options: {
  theme: Accessor<SyntaxThemePalette>
  logger: Logger
  getSchemaState: () => SqlEditorSchemaState
}): SqlSupport {
  const analysis = createSqlAnalysis({
    theme: options.theme,
    logger: options.logger,
  })
  const worker = createSqlEditorBgWorkerAdapter({
    getState: options.getSchemaState,
    logger: options.logger,
  })

  return {
    analysis: analysis.analysis,
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
