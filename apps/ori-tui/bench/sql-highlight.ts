import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { addDefaultParsers, getTreeSitterClient } from "@opentui/core"
import { buildLineStarts, offsetToLineCol } from "@utils/line-offsets"
import sqlHighlights from "../src/assets/highlights.scm" with { type: "file" }
import sqlWasm from "../src/assets/tree-sitter-sql.wasm" with { type: "file" }
import { collectSqlQueries } from "../src/ui/widgets/editor-panel/sql-statement-detector"

type HighlightTuple = [startIndex: number, endIndex: number, group: string]

type Span = {
  start: number
  end: number
  styleId: number
}

type CachedStatement = {
  text: string
  start: number
  spans: Span[]
}

type HighlightSnapshot = {
  statements: CachedStatement[]
  spans: Span[]
}

type BenchCase = {
  name: string
  beforeText: string
  afterText: string
  statements: number
}

const FILETYPE_SQL = "sql"
const RUNS = 25
const WARM_UP_RUNS = 5
const ASSET_BASE = dirname(fileURLToPath(import.meta.url))
const SQL_WASM_PATH = resolve(ASSET_BASE, sqlWasm)
const SQL_HIGHLIGHTS_URL = resolve(ASSET_BASE, sqlHighlights)

function percentile(samples: readonly number[], ratio: number) {
  const sorted = [...samples].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))
  return sorted[index] ?? 0
}

function formatMs(value: number) {
  return `${value.toFixed(value >= 100 ? 1 : value >= 10 ? 2 : 3)} ms`
}

function pad(value: string, width: number) {
  return value.length >= width ? value : value + " ".repeat(width - value.length)
}

function printTable(headers: string[], rows: string[][]) {
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)))
  console.log(headers.map((header, index) => pad(header, widths[index] ?? header.length)).join("  "))
  console.log(widths.map((width) => "-".repeat(width)).join("  "))
  for (const row of rows) {
    console.log(row.map((value, index) => pad(value, widths[index] ?? value.length)).join("  "))
  }
}

async function ensureSqlRegistered() {
  addDefaultParsers([
    {
      filetype: FILETYPE_SQL,
      wasm: SQL_WASM_PATH,
      queries: { highlights: [SQL_HIGHLIGHTS_URL] },
    },
  ])
  const client = getTreeSitterClient()
  await client.initialize?.()
  await client.preloadParser?.(FILETYPE_SQL)
}

async function highlightOnce(text: string): Promise<HighlightTuple[]> {
  const result = (await getTreeSitterClient().highlightOnce(text, FILETYPE_SQL)) as {
    highlights?: HighlightTuple[]
    warning?: string
    error?: string
  }
  if (result.error) {
    throw new Error(result.error)
  }
  return result.highlights ?? []
}

function mapGroup(group: string) {
  switch (group) {
    case "keyword":
      return 1
    case "keyword.operator":
      return 2
    case "string":
      return 3
    case "comment":
      return 4
    case "number":
      return 5
    case "float":
      return 6
    case "boolean":
      return 7
    case "operator":
      return 8
    case "function.call":
      return 9
    case "variable":
      return 10
    case "field":
      return 11
    case "parameter":
      return 12
    case "attribute":
      return 13
    case "storageclass":
      return 14
    case "conditional":
      return 15
    case "type":
      return 16
    case "type.qualifier":
      return 17
    case "type.builtin":
      return 18
    case "punctuation.bracket":
      return 19
    case "punctuation.delimiter":
      return 20
    default:
      return 0
  }
}

function collectStatements(text: string) {
  return collectSqlQueries(text, buildLineStarts(text)).map((statement) => ({
    start: statement.start,
    end: statement.end,
    text: text.slice(statement.start, statement.end),
  }))
}

async function highlightStatement(text: string, start: number) {
  const spans: Span[] = []
  for (const [spanStart, spanEnd, group] of await highlightOnce(text)) {
    const styleId = mapGroup(group)
    if (!styleId) {
      continue
    }
    spans.push({ start: spanStart, end: spanEnd, styleId })
  }
  return {
    text,
    start,
    spans,
  } satisfies CachedStatement
}

function flattenStatements(statements: readonly CachedStatement[]) {
  const spans: Span[] = []
  for (const statement of statements) {
    for (const span of statement.spans) {
      spans.push({
        start: span.start + statement.start,
        end: span.end + statement.start,
        styleId: span.styleId,
      })
    }
  }
  return spans
}

function stablePrefixCount(previous: readonly CachedStatement[], next: ReturnType<typeof collectStatements>) {
  let count = 0
  for (; count < previous.length && count < next.length; count += 1) {
    if (previous[count]?.text !== next[count]?.text) {
      break
    }
  }
  return count
}

function stableSuffixCount(
  previous: readonly CachedStatement[],
  next: ReturnType<typeof collectStatements>,
  prefix: number,
) {
  let count = 0
  for (; count < previous.length - prefix && count < next.length - prefix; count += 1) {
    const previousIndex = previous.length - 1 - count
    const nextIndex = next.length - 1 - count
    if (previous[previousIndex]?.text !== next[nextIndex]?.text) {
      break
    }
  }
  return count
}

async function currentSqlHighlights(text: string) {
  const statements = collectStatements(text)
  const highlighted: CachedStatement[] = []
  for (const statement of statements) {
    highlighted.push(await highlightStatement(statement.text, statement.start))
  }
  return {
    statements: highlighted,
    spans: flattenStatements(highlighted),
  } satisfies HighlightSnapshot
}

async function incrementalSqlHighlights(text: string, previous?: HighlightSnapshot) {
  if (!previous) {
    return currentSqlHighlights(text)
  }

  const statements = collectStatements(text)
  const prefix = stablePrefixCount(previous.statements, statements)
  const suffix = stableSuffixCount(previous.statements, statements, prefix)
  const nextStatements: CachedStatement[] = []

  for (let index = 0; index < prefix; index += 1) {
    const cached = previous.statements[index]
    const statement = statements[index]
    if (!cached || !statement) {
      continue
    }
    nextStatements.push({
      text: statement.text,
      start: statement.start,
      spans: cached.spans,
    })
  }

  for (let index = prefix; index < statements.length - suffix; index += 1) {
    const statement = statements[index]
    if (!statement) {
      continue
    }
    nextStatements.push(await highlightStatement(statement.text, statement.start))
  }

  for (let offset = suffix; offset > 0; offset -= 1) {
    const previousIndex = previous.statements.length - offset
    const nextIndex = statements.length - offset
    const cached = previous.statements[previousIndex]
    const statement = statements[nextIndex]
    if (!cached || !statement) {
      continue
    }
    nextStatements.push({
      text: statement.text,
      start: statement.start,
      spans: cached.spans,
    })
  }

  return {
    statements: nextStatements,
    spans: flattenStatements(nextStatements),
  } satisfies HighlightSnapshot
}

function currentSpanMap(spans: readonly Span[], lineStarts: number[]) {
  const spansByLine = new Map<number, Span[]>()
  for (const span of spans) {
    const start = offsetToLineCol(span.start, lineStarts)
    const end = offsetToLineCol(span.end, lineStarts)
    if (start.line !== end.line) {
      continue
    }
    const lineSpans = spansByLine.get(start.line) ?? []
    lineSpans.push({ start: start.col, end: end.col, styleId: span.styleId })
    spansByLine.set(start.line, lineSpans)
  }
  for (const lineSpans of spansByLine.values()) {
    lineSpans.sort((a, b) => a.start - b.start || a.end - b.end)
  }
  return spansByLine
}

function streamingSpanMap(spans: readonly Span[], lineStarts: number[]) {
  const spansByLine = new Map<number, Span[]>()
  let line = 0
  for (const span of spans) {
    while (line + 1 < lineStarts.length && span.start >= lineStarts[line + 1]!) {
      line += 1
    }
    const lineStart = lineStarts[line] ?? 0
    const nextStart = line + 1 < lineStarts.length ? lineStarts[line + 1]! : Number.POSITIVE_INFINITY
    if (span.end > nextStart) {
      continue
    }
    const lineSpans = spansByLine.get(line) ?? []
    lineSpans.push({ start: span.start - lineStart, end: span.end - lineStart, styleId: span.styleId })
    spansByLine.set(line, lineSpans)
  }
  for (const lineSpans of spansByLine.values()) {
    lineSpans.sort((a, b) => a.start - b.start || a.end - b.end)
  }
  return spansByLine
}

function statement(index: number, variant: "before" | "after") {
  const alias = variant === "before" ? "status_name" : "status_label"
  return [
    `-- statement ${index + 1}`,
    `select o.order_id, o.created_at, u.email, coalesce(o.status, 'unknown') as ${alias}_${String(index + 1).padStart(4, "0")}`,
    "from analytics.fact_orders o",
    "join analytics.dim_users u on u.user_id = o.user_id",
    "where o.created_at >= current_date - interval '7 day'",
    "order by o.created_at desc;",
  ].join("\n")
}

function manyStatements(count: number, editIndex: number, variant: "before" | "after") {
  const statements: string[] = []
  for (let index = 0; index < count; index += 1) {
    statements.push(statement(index, index === editIndex ? variant : "before"))
  }
  return statements.join("\n\n")
}

function wideQuery(variant: "before" | "after") {
  const alias = variant === "before" ? "order_status" : "order_state"
  const projections: string[] = []
  for (let i = 0; i < 250; i += 1) {
    const suffix = String(i + 1).padStart(3, "0")
    projections.push(`o.created_at as order_created_at_${suffix}`)
    projections.push(`o.status as ${alias}_${suffix}`)
    projections.push(`u.email as user_email_${suffix}`)
  }
  return [
    "with recent_orders as (",
    "  select * from analytics.fact_orders where created_at >= current_date - interval '30 day'",
    ")",
    "select",
    `  ${projections.join(",\n  ")}`,
    "from recent_orders o",
    "join analytics.fact_payments p on p.order_id = o.order_id",
    "join analytics.fact_shipments s on s.order_id = o.order_id",
    "join analytics.fact_refunds r on r.order_id = o.order_id",
    "join analytics.dim_users u on u.user_id = o.user_id",
    "join analytics.dim_regions g on g.region_id = u.region_id",
    "where o.status in ('paid', 'settled')",
    "order by o.created_at desc;",
  ].join("\n")
}

function cases() {
  return [
    {
      name: "single wide query edit",
      beforeText: wideQuery("before"),
      afterText: wideQuery("after"),
      statements: 1,
    },
    {
      name: "100 statements edit",
      beforeText: manyStatements(100, 49, "before"),
      afterText: manyStatements(100, 49, "after"),
      statements: 100,
    },
    {
      name: "500 statements edit",
      beforeText: manyStatements(500, 249, "before"),
      afterText: manyStatements(500, 249, "after"),
      statements: 500,
    },
    {
      name: "1500 statements edit",
      beforeText: manyStatements(1500, 749, "before"),
      afterText: manyStatements(1500, 749, "after"),
      statements: 1500,
    },
  ] satisfies BenchCase[]
}

async function measureAsync<T>(fn: () => Promise<T>) {
  for (let i = 0; i < WARM_UP_RUNS; i += 1) {
    await fn()
  }
  const samples: number[] = []
  let value: T | undefined
  for (let i = 0; i < RUNS; i += 1) {
    const start = Bun.nanoseconds()
    value = await fn()
    samples.push(Number(Bun.nanoseconds() - start) / 1_000_000)
  }
  return { median: percentile(samples, 0.5), p95: percentile(samples, 0.95), value }
}

function measureSync<T>(fn: () => T) {
  for (let i = 0; i < WARM_UP_RUNS; i += 1) {
    fn()
  }
  const samples: number[] = []
  let value: T | undefined
  for (let i = 0; i < RUNS; i += 1) {
    const start = Bun.nanoseconds()
    value = fn()
    samples.push(Number(Bun.nanoseconds() - start) / 1_000_000)
  }
  return { median: percentile(samples, 0.5), p95: percentile(samples, 0.95), value }
}

async function main() {
  await ensureSqlRegistered()
  console.log("SQL highlight benchmark")
  console.log("")
  const editRows: string[][] = []
  const mapRows: string[][] = []
  for (const benchCase of cases()) {
    const beforeSnapshot = await currentSqlHighlights(benchCase.beforeText)
    const fullRefresh = await measureAsync(() => currentSqlHighlights(benchCase.afterText))
    const incremental = await measureAsync(() => incrementalSqlHighlights(benchCase.afterText, beforeSnapshot))
    const lineStarts = buildLineStarts(benchCase.afterText)
    const spans = incremental.value?.spans ?? []
    const currentMap = measureSync(() => currentSpanMap(spans, lineStarts))
    const streamingMap = measureSync(() => streamingSpanMap(spans, lineStarts))
    editRows.push([
      benchCase.name,
      String(benchCase.afterText.length),
      String(lineStarts.length),
      String(benchCase.statements),
      String(spans.length),
      formatMs(fullRefresh.median),
      formatMs(incremental.median),
      `${(fullRefresh.median / incremental.median).toFixed(1)}x`,
    ])
    mapRows.push([
      benchCase.name,
      String(spans.length),
      formatMs(currentMap.median),
      formatMs(streamingMap.median),
      `${(currentMap.median / streamingMap.median).toFixed(1)}x`,
    ])
  }
  console.log("Statement-local edit highlight")
  printTable(
    ["case", "chars", "lines", "statements", "spans", "full refresh", "incremental", "speedup"],
    editRows,
  )
  console.log("")
  console.log("Span to line mapping")
  printTable(["case", "spans", "current binary", "streaming", "speedup"], mapRows)
}

await main()
process.exit(0)
