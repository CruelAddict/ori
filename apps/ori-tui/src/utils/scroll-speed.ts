import type { MouseEvent } from "@opentui/core"

export type ScrollSpeedMultipliers = {
  horizontal?: number
  vertical?: number
}

type ScrollDirection = "up" | "down" | "left" | "right"
type MouseHandler = (event: MouseEvent) => void

const defaultMultipliers = {
  horizontal: 3,
  vertical: 1,
}

export function getScrollDirection(event: MouseEvent): ScrollDirection | undefined {
  const direction = event.scroll?.direction
  if (!direction) return undefined
  if (!event.modifiers?.shift) return direction
  if (direction === "up") return "left"
  if (direction === "down") return "right"
  if (direction === "right") return "down"
  return "up"
}

export function createScrollSpeedHandler(
  baseHandler: MouseHandler | undefined,
  multipliers: ScrollSpeedMultipliers,
): MouseHandler {
  const handler = baseHandler
  const { horizontal, vertical } = { ...defaultMultipliers, ...multipliers }

  return (event: MouseEvent) => {
    if (!handler) return
    if (event.type !== "scroll" || !event.scroll) {
      handler(event)
      return
    }

    const direction = getScrollDirection(event)
    const axisMultiplier = direction === "left" || direction === "right" ? horizontal : vertical
    if (axisMultiplier === 1) {
      handler(event)
      return
    }

    const baseDelta = typeof event.scroll.delta === "number" ? event.scroll.delta : 0
    const scaledEvent = {
      ...event,
      scroll: {
        ...event.scroll,
        delta: baseDelta * axisMultiplier,
      },
    } as MouseEvent

    handler(scaledEvent)
  }
}
