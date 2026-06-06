import type { Renderable, TextareaRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { Buffer, createStatementGutterMarkersExtension, createStatementsExtension } from "@ui/components/buffer"
import { LoggerProvider } from "@ui/providers/logger"
import { ThemeProvider } from "@ui/providers/theme"
import { KeymapProvider } from "@ui/services/key-scopes"
import { analyzeSqlDocument } from "@ui/widgets/editor-panel/sql-statement-detector"
import pino from "pino"

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

function BenchBuffer(props: { text: string; context: boolean }) {
  const statementsExtension = props.context
    ? createStatementsExtension({
        id: "bench-sql-statements",
        detect: (text, lineStarts) => analyzeSqlDocument(text, lineStarts).queries,
      })
    : undefined
  const extensions = statementsExtension
    ? [
        statementsExtension.extension,
        createStatementGutterMarkersExtension({
          id: "bench-sql-statement-gutter-markers",
          statements: statementsExtension.source,
        }),
      ]
    : []

  return (
    <Buffer
      initialText={props.text}
      isFocused={() => true}
      onTextChange={() => {}}
      focusSelf={() => {}}
      extensions={extensions}
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
