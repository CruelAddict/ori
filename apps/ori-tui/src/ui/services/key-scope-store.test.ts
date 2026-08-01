import { describe, expect, test } from "bun:test"
import { KeyScopeStore, OVERLAY_LAYER_START, SELECTION_LAYER } from "./key-scope-store"

function register(store: KeyScopeStore, id: string, layer: number) {
  store.registerScope({
    id,
    layer,
    getBindings: () => [],
    isEnabled: () => true,
  })
}

describe("KeyScopeStore selection layer", () => {
  test("falls through from selection bindings to base pane bindings", () => {
    const store = new KeyScopeStore()
    register(store, "base", 0)
    register(store, "selection", SELECTION_LAYER)

    expect(store.getDispatchPlan().primary.map((scope) => scope.id)).toEqual(["selection", "base"])
  })

  test("does not include selection bindings while an overlay is active", () => {
    const store = new KeyScopeStore()
    register(store, "base", 0)
    register(store, "selection", SELECTION_LAYER)
    register(store, "overlay", OVERLAY_LAYER_START)

    expect(store.getDispatchPlan().primary.map((scope) => scope.id)).toEqual(["overlay"])
  })
})
