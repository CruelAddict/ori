import type { Renderable, TextareaRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { Buffer, type BufferContext } from "@ui/components/buffer"
import { LoggerProvider } from "@ui/providers/logger"
import { ThemeProvider } from "@ui/providers/theme"
import { KeymapProvider } from "@ui/services/key-scopes"
import { analyzeSqlDocument, type SqlDocumentAnalysis } from "@ui/widgets/editor-panel/sql-statement-detector"
import pino from "pino"
import { createMemo, createSignal } from "solid-js"

type BenchCase = {
  name: string
  text: string
  targetLine: number
  context: boolean
}

const RUNS = 40
const WARMUP = 5
const WIDTH = 120
const HEIGHT = 34
const EMPTY_MARKERS = new Map<number, string>()
const SETTLE_MS = Number(Bun.env.ORI_BENCH_SETTLE_MS ?? "0")

const query = `WITH RECURSIVE seq(n) AS (
  SELECT 1
  UNION ALL
  SELECT n + 1
  FROM seq
  WHERE n < 1000
)
SELECT
  n AS id,
  printf('row_%04d', n) AS row_name,
  datetime('now', printf('-%d minutes', n)) AS created_at,
  hex(randomblob(96)) || ' | ' || hex(randomblob(96)) AS long_text_a,
  'payload_' || n || '::' || hex(randomblob(128)) AS long_text_b
FROM seq;`

function repeatedQuery(count: number) {
  return Array.from({ length: count }, () => query).join("")
}

function percentile(samples: readonly number[], ratio: number) {
  const sorted = [...samples].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))
  return sorted[index] ?? 0
}

function formatMs(value: number) {
  return `${value.toFixed(value >= 100 ? 1 : value >= 10 ? 2 : 3)} ms`
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function collectTextareas(node: Renderable): TextareaRenderable[] {
  const own = node.constructor.name === "TextareaRenderable" ? [node as TextareaRenderable] : []
  return [...own, ...node.getChildren().flatMap((child) => collectTextareas(child))]
}

function makeMarkers(analysis: SqlDocumentAnalysis | undefined, cursorLine: number, hasCursor: boolean) {
  if (!analysis || analysis.queries.length < 2) {
    return EMPTY_MARKERS
  }

  const activeLine = hasCursor ? (analysis.queryStartLineByLine[cursorLine] ?? -1) : -1
  const markers = new Map(analysis.queries.map((query) => [query.startLine, "• "]))
  if (activeLine >= 0) {
    markers.set(activeLine, "󰻃 ")
  }
  return markers
}

function BenchBuffer(props: { text: string; context: boolean }) {
  const [context, setContext] = createSignal<BufferContext>()
  const [analysis, setAnalysis] = createSignal<SqlDocumentAnalysis>()
  const markers = createMemo(() => {
    const current = context()
    return makeMarkers(analysis(), current?.focusedRow ?? -1, current?.cursorOffset !== undefined)
  })

  const handleContext = (next: BufferContext) => {
    if (!props.context) {
      return
    }

    setContext(next)
    setAnalysis(analyzeSqlDocument(next.text, next.lineStarts))
  }

  return (
    <Buffer
      initialText={props.text}
      language="sql"
      isFocused={() => true}
      onTextChange={() => {}}
      focusSelf={() => {}}
      onContextChange={props.context ? handleContext : undefined}
      gutterMarkers={props.context ? markers : undefined}
    />
  )
}

function App(props: { text: string; context: boolean }) {
  const logger = pino({ enabled: false })
  return (
    <LoggerProvider logger={logger}>
      <ThemeProvider defaultTheme="default">
        <KeymapProvider>
          <box flexDirection="column">
            <box height={1}>
              <text>No query executed yet</text>
            </box>
            <box height={HEIGHT - 1}>
              <BenchBuffer
                text={props.text}
                context={props.context}
              />
            </box>
          </box>
        </KeymapProvider>
      </ThemeProvider>
    </LoggerProvider>
  )
}

async function pressDown(setup: Awaited<ReturnType<typeof testRender>>, count: number) {
  for (let i = 0; i < count; i += 1) {
    setup.mockInput.pressArrow("down")
    await setup.renderOnce()
  }
}

async function createTestSetup(item: BenchCase) {
  return testRender(() => <App text={item.text} context={item.context} />, {
    width: WIDTH,
    height: HEIGHT,
    targetFps: 120,
  })
}

async function runCase(item: BenchCase) {
  const setup = await createTestSetup(item)
  await setup.renderOnce()

  const textareas = collectTextareas(setup.renderer.root)
  textareas[0]?.focus()
  await pressDown(setup, item.targetLine)

  const samples: number[] = []
  for (let i = 0; i < WARMUP + RUNS; i += 1) {
    const char = i % 2 === 0 ? "x" : "y"
    const started = performance.now()
    setup.mockInput.pressKey(char)
    await setup.renderOnce()
    if (SETTLE_MS > 0) {
      await sleep(SETTLE_MS)
      await setup.renderOnce()
    }
    const elapsed = performance.now() - started
    if (i >= WARMUP) {
      samples.push(elapsed)
    }
  }

  await Promise.resolve()
  setup.renderer.destroy()

  return {
    name: item.name,
    textareas: textareas.length,
    median: percentile(samples, 0.5),
    p95: percentile(samples, 0.95),
    max: Math.max(...samples),
  }
}

const cases: BenchCase[] = [
  { name: "bad-x4/editor-only", text: repeatedQuery(4), targetLine: 42, context: true },
  { name: "bad-x12/editor-only", text: repeatedQuery(12), targetLine: 42, context: true },
  { name: "bad-x50/editor-only", text: repeatedQuery(50), targetLine: 42, context: true },
]

for (const item of cases) {
  const result = await runCase(item)
  console.log(
    `${result.name}: textareas=${result.textareas} median=${formatMs(result.median)} p95=${formatMs(result.p95)} max=${formatMs(result.max)}`,
  )
}
