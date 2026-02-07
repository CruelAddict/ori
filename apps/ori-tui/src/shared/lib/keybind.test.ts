import { describe, expect, test } from "bun:test"
import { Keybind, type ParsedKeybind, useKeybind } from "./keybind"

const key = (event: ParsedKeybind): ParsedKeybind => event

describe("Keybind.match", () => {
  test("matches alt+left when only alt is set", () => {
    const event = key({ name: "left", ctrl: false, meta: false, shift: false, alt: true })
    expect(Keybind.match("alt+left", event)).toBe(true)
  })

  test("matches alt+left when terminal also sets meta", () => {
    const event = key({ name: "left", ctrl: false, meta: true, shift: false, alt: true })
    expect(Keybind.match("alt+left", event)).toBe(true)
  })

  test("does not treat alt+left as meta+left", () => {
    const event = key({ name: "left", ctrl: false, meta: true, shift: false, alt: true })
    expect(Keybind.match("meta+left", event)).toBe(false)
  })

  test("treats escape-meta left as alt+left", () => {
    const parser = useKeybind()
    const event = parser.parse({
      name: "left",
      ctrl: false,
      meta: true,
      shift: false,
      option: false,
      raw: "\u001bB",
    })
    expect(Keybind.match("alt+left", event)).toBe(true)
  })
})
