import { type Renderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import pino from "pino"
import { createComponent } from "solid-js"
import { LoggerProvider } from "@ui/providers/logger"
import { ThemeProvider } from "@ui/providers/theme"
import { KeymapProvider } from "@ui/services/key-scopes"

type HarnessOptions = {
  width: number
  height: number
  targetFps?: number
}

type Predicate<T extends Renderable> = (node: Renderable) => node is T

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function walk<T extends Renderable>(node: Renderable | undefined, predicate: Predicate<T>): T | undefined {
  if (!node) {
    return undefined
  }
  if (predicate(node)) {
    return node
  }

  for (const child of node.getChildren?.() ?? []) {
    const hit = walk(child, predicate)
    if (hit) {
      return hit
    }
  }

  return undefined
}

function wrapWithProviders(render: () => unknown) {
  return () =>
    createComponent(LoggerProvider, {
      logger: pino({ enabled: false }),
      get children() {
        return createComponent(KeymapProvider, {
          get children() {
            return createComponent(ThemeProvider, {
              defaultTheme: "dark",
              get children() {
                return render()
              },
            })
          },
        })
      },
    })
}

export async function mountInTui(render: () => unknown, options: HarnessOptions) {
  const setup = await testRender(wrapWithProviders(render), {
    width: options.width,
    height: options.height,
    targetFps: options.targetFps ?? 120,
  })

  const renderOnce = async () => {
    // OpenTUI may schedule follow-up work on the next tick after a render pass.
    await setup.renderOnce()
    await sleep(0)
    await setup.renderOnce()
  }

  const waitFor = async (predicate: () => boolean, timeoutMs = 1500) => {
    const start = performance.now()
    while (performance.now() - start < timeoutMs) {
      await renderOnce()
      if (predicate()) {
        return
      }
      await sleep(20)
    }

    throw new Error("Timed out waiting for OpenTUI test condition")
  }

  await renderOnce()

  return {
    setup,
    renderOnce,
    waitFor,
    destroy: () => setup.renderer.destroy(),
    find<T extends Renderable>(predicate: Predicate<T>) {
      return walk(setup.renderer.root, predicate)
    },
  }
}
export type MountedTuiApp = Awaited<ReturnType<typeof mountInTui>>
