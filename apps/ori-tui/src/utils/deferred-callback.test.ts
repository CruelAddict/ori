import { describe, expect, test } from "bun:test"
import { createDeferredCallback } from "./deferred-callback"

const waitForMicrotask = () => Promise.resolve()

describe("createDeferredCallback", () => {
  test("coalesces calls into one microtask", async () => {
    let calls = 0
    const callback = createDeferredCallback(() => {
      calls += 1
    })

    callback()
    callback()
    callback()

    expect(calls).toBe(0)
    await waitForMicrotask()
    expect(calls).toBe(1)
  })

  test("cancels a queued callback", async () => {
    let calls = 0
    const callback = createDeferredCallback(() => {
      calls += 1
    })

    callback()
    callback.cancel()
    await waitForMicrotask()

    expect(calls).toBe(0)
  })
})
