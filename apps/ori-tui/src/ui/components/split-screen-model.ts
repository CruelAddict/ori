export type SplitOrientation = "vertical" | "horizontal"

export type SplitPosition =
  | {
    mode: "ratio"
    ratio: number
  }
  | {
    mode: "start"
    offset: number
  }
  | {
    mode: "end"
    offset: number
  }

export type SplitLayoutInput = {
  axisSize: number
  minFirstSize: number
  minSecondSize: number
  position: SplitPosition
}

export type SplitLayout = {
  axisSize: number
  availableSize: number
  firstSize: number
  secondSize: number
}

export const DEFAULT_SPLIT_POSITION: SplitPosition = {
  mode: "ratio",
  ratio: 0.5,
}

export function resolveSplitLayout(input: SplitLayoutInput): SplitLayout {
  const axisSize = input.axisSize
  const availableSize = Math.max(0, axisSize - 1)

  const firstRaw = getFirstSizeByPosition(input.position, availableSize)
  const firstSize = clampToBounds(firstRaw, getFirstBounds(availableSize, input.minFirstSize, input.minSecondSize))
  const secondSize = Math.max(0, availableSize - firstSize)

  return {
    axisSize,
    availableSize,
    firstSize,
    secondSize,
  }
}

export function createPositionFromFirstSize(
  position: SplitPosition,
  firstSize: number,
  availableSize: number,
): SplitPosition {
  const first = firstSize
  const available = availableSize

  if (position.mode === "ratio") {
    if (available === 0) {
      return { mode: "ratio", ratio: 0 }
    }
    return {
      mode: "ratio",
      ratio: first / available,
    }
  }

  if (position.mode === "start") {
    return {
      mode: "start",
      offset: first,
    }
  }

  return {
    mode: "end",
    offset: Math.max(0, available - first),
  }
}

function getFirstSizeByPosition(position: SplitPosition, availableSize: number): number {
  if (position.mode === "start") {
    return position.offset
  }
  if (position.mode === "end") {
    return Math.max(0, availableSize - position.offset)
  }
  const ratio = Number.isFinite(position.ratio) ? position.ratio : 0
  const clampedRatio = Math.max(0, Math.min(1, ratio))
  return Math.round(availableSize * clampedRatio)
}

function getFirstBounds(availableSize: number, minFirstSize: number, minSecondSize: number) {
  const minFirst = Math.min(availableSize, minFirstSize)
  const minSecond = Math.min(availableSize, minSecondSize)
  const maxFirst = Math.max(minFirst, availableSize - minSecond)
  return { min: minFirst, max: maxFirst }
}

function clampToBounds(value: number, bounds: { min: number; max: number }) {
  return Math.min(bounds.max, Math.max(bounds.min, value))
}
