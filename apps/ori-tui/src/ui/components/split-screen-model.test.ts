import { describe, expect, test } from "bun:test"
import { createPositionFromFirstSize, resolveSplitLayout } from "./split-screen-model"

describe("resolveSplitLayout", () => {
  test("ratio 0.5", () => {
    const layout = resolveSplitLayout({
      axisSize: 10,
      minFirstSize: 0,
      minSecondSize: 0,
      position: { mode: "ratio", ratio: 0.5 },
    })

    expect(layout.availableSize).toBe(9)
    expect(layout.firstSize).toBe(5)
    expect(layout.secondSize).toBe(4)
  })

  test("start offset 5", () => {
    const layout = resolveSplitLayout({
      axisSize: 20,
      minFirstSize: 0,
      minSecondSize: 0,
      position: { mode: "start", offset: 5 },
    })

    expect(layout.firstSize).toBe(5)
    expect(layout.secondSize).toBe(14)
  })

  test("end offset 5", () => {
    const layout = resolveSplitLayout({
      axisSize: 20,
      minFirstSize: 0,
      minSecondSize: 0,
      position: { mode: "end", offset: 5 },
    })

    expect(layout.firstSize).toBe(14)
    expect(layout.secondSize).toBe(5)
  })

  test("respects min pane size", () => {
    const layout = resolveSplitLayout({
      axisSize: 40,
      minFirstSize: 10,
      minSecondSize: 12,
      position: { mode: "start", offset: 35 },
    })

    expect(layout.firstSize).toBe(27)
    expect(layout.secondSize).toBe(12)
  })
})

describe("createPositionFromFirstSize", () => {
  test("in ratio mode", () => {
    const next = createPositionFromFirstSize({ mode: "ratio", ratio: 0.1 }, 9, 18)
    if (next.mode !== "ratio") {
      throw new Error("Expected ratio mode")
    }
    expect(next.ratio).toBe(0.5)
  })

  test("in start mode", () => {
    const next = createPositionFromFirstSize({ mode: "start", offset: 5 }, 11, 20)
    if (next.mode !== "start") {
      throw new Error("Expected start mode")
    }
    expect(next.offset).toBe(11)
  })

  test("in end mode", () => {
    const next = createPositionFromFirstSize({ mode: "end", offset: 5 }, 11, 20)
    if (next.mode !== "end") {
      throw new Error("Expected end mode")
    }
    expect(next.offset).toBe(9)
  })
})
