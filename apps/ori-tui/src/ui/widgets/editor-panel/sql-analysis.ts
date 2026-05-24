import type { BufferAnalysis, BufferAnalysisSnapshot } from "@ui/components/buffer/analysis"
import type { DocCharOffset, LineIndex } from "@ui/components/buffer/coords"
import { offsetToLineCol } from "@utils/line-offsets"
import { syntaxHighlighter } from "@utils/syntax-highlighter"
import type { Logger } from "pino"
import { type Accessor, createSignal } from "solid-js"
import { collectSqlQueries } from "./sql-statement-detector"

export type SqlQuery = {
  id: string
  start: DocCharOffset
  end: DocCharOffset
  startLine: LineIndex
  endLine: LineIndex
}

export type SqlQueryResolution = { kind: "query"; query: SqlQuery } | { kind: "ambiguous" } | { kind: "none" }

export type SqlAnalysisSnapshot = {
  queries: SqlQuery[]
  queryStartLineByLine: number[]
}

type SyntaxThemePalette = {
  get(group: string): string
}

function mapQuery(query: BufferAnalysisSnapshot["entries"][number]): SqlQuery {
  return {
    id: query.id,
    start: query.start,
    end: query.end,
    startLine: query.startLine,
    endLine: query.endLine,
  }
}

function buildQueryStartLineByLine(queries: readonly SqlQuery[], lineCount: number) {
  const lines = Array.from({ length: lineCount }, () => -1)

  for (const query of queries) {
    for (let line = Number(query.startLine); line <= query.endLine; line += 1) {
      const current = lines[line]
      if (current === -1) {
        lines[line] = query.startLine
        continue
      }
      if (current === query.startLine) {
        continue
      }
      lines[line] = -2
    }
  }

  return lines
}

function resolveCursorLine(text: string, lineStarts: readonly DocCharOffset[], offset: DocCharOffset) {
  if (!text.length) {
    return 0
  }

  const cursor = Math.max(0, Math.min(offset, text.length))
  const probe = cursor === text.length && cursor > 0 ? cursor - 1 : cursor
  return offsetToLineCol(probe, lineStarts).line
}

export function resolveSqlQueryAtOffset(
  snapshot: SqlAnalysisSnapshot,
  lineStarts: readonly DocCharOffset[],
  text: string,
  offset: DocCharOffset,
): SqlQueryResolution {
  const line = resolveCursorLine(text, lineStarts, offset)
  const startLine = snapshot.queryStartLineByLine[line] ?? -1
  if (startLine === -2) {
    return { kind: "ambiguous" }
  }
  if (startLine < 0) {
    return { kind: "none" }
  }

  const query = snapshot.queries.find(
    (item) => item.startLine === startLine && item.startLine <= line && line <= item.endLine,
  )
  if (!query) {
    return { kind: "none" }
  }

  return { kind: "query", query }
}

export function createSqlAnalysis(params: { theme: Accessor<SyntaxThemePalette>; logger: Logger }) {
  const highlighter = syntaxHighlighter({
    theme: params.theme,
    language: "sql",
    logger: params.logger,
  })
  const [snapshot, setSnapshot] = createSignal<SqlAnalysisSnapshot>({
    queries: [],
    queryStartLineByLine: [],
  })

  const refreshSnapshot = (analysisSnapshot: BufferAnalysisSnapshot | undefined, lineCount: number) => {
    const queries = analysisSnapshot?.entries.map((entry) => mapQuery(entry)) ?? []
    setSnapshot({
      queries,
      queryStartLineByLine: buildQueryStartLineByLine(queries, lineCount),
    })
  }

  const analysis: BufferAnalysis = {
    languageId: "sql",
    syntaxStyle: () => highlighter.highlightResult().syntaxStyle,
    collectRanges: (text, lineStarts) => collectSqlQueries(text, lineStarts),
    highlightText: (text) => highlighter.highlightText(text),
    onSnapshotChange: refreshSnapshot,
    onHighlightError: (err, updateVersion) => {
      params.logger.error({ err, updateVersion }, "sql-analysis: statement highlight failed")
    },
  }

  return {
    analysis,
    snapshot,
    dispose: () => {
      highlighter.dispose()
    },
  }
}
