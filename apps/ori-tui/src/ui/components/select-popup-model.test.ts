import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createSelectPopup } from "./select-popup-model"

describe("select popup model", () => {
  test("resets selection to the first item when the previous item disappears", () => {
    createRoot((dispose) => {
      const popup = createSelectPopup({
        onSelect: () => true,
      })

      popup.setItems([
        { id: "authors", label: "authors" },
        { id: "books", label: "books" },
        { id: "users", label: "users" },
      ])
      popup.hover(2)
      popup.setItems([
        { id: "where", label: "where" },
        { id: "returning", label: "returning" },
      ])

      expect(popup.selectedIndex()).toBe(0)
      dispose()
    })
  })

  test("keeps selection when the same item is still present", () => {
    createRoot((dispose) => {
      const popup = createSelectPopup({
        onSelect: () => true,
      })

      popup.setItems([
        { id: "authors", label: "authors" },
        { id: "books", label: "books" },
      ])
      popup.hover(1)
      popup.setItems([
        { id: "where", label: "where" },
        { id: "books", label: "books" },
        { id: "returning", label: "returning" },
      ])

      expect(popup.selectedIndex()).toBe(1)
      dispose()
    })
  })

  test("respects explicit selected index override", () => {
    createRoot((dispose) => {
      const popup = createSelectPopup({
        onSelect: () => true,
      })

      popup.setItems([
        { id: "authors", label: "authors" },
        { id: "books", label: "books" },
      ])
      popup.hover(1)
      popup.setItems(
        [
          { id: "lead", label: "lead" },
          { id: "length", label: "length" },
        ],
        { selectedIndex: 0 },
      )

      expect(popup.selectedIndex()).toBe(0)
      dispose()
    })
  })
})
