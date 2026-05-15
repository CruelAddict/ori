import { type Renderable } from "@opentui/core"
import type { MountedTuiApp } from "./opentui-harness"

type Predicate<T extends Renderable> = (node: Renderable) => node is T

export function requirePresent<T>(value: T | undefined, message: string) {
  if (value === undefined) {
    throw new Error(message)
  }

  return value
}

export function findRequiredNode<T extends Renderable>(
  app: MountedTuiApp,
  predicate: Predicate<T>,
  message: string,
) {
  return requirePresent(app.find(predicate), message)
}

export function readFrameLines(app: MountedTuiApp) {
  return app.setup.captureSpans().lines.map((line) => line.spans.map((span) => span.text).join(""))
}

export function readFrameText(app: MountedTuiApp) {
  return readFrameLines(app).join("\n")
}

export function readFrameLineTokens(app: MountedTuiApp, lineIndex: number) {
  return app.setup.captureSpans().lines[lineIndex]?.spans.map((span) => span.text) ?? []
}
