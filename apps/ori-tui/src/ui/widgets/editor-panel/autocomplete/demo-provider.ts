import type { BufferAutocompleteProvider } from "@ui/components/buffer"
import { docCharRange } from "@ui/components/buffer/buffer-model/coords"

const words = [
  "autocomplete",
  "autobahn",
  "automobile",
  "albuquerque",
  "alphabet",
  "almanac",
  "altitude",
  "anchor",
  "android",
  "anatomy",
  "angular",
  "aperture",
  "asteroid",
  "avalanche",
  "azure",
]

export function createDemoAutocompleteProvider(): BufferAutocompleteProvider {
  return {
    getCompletions: ({ text, cursor }) => {
      const prefix = text
        .slice(0, cursor)
        .match(/[A-Za-z]+$/)?.[0]
        ?.toLowerCase()
      if (!prefix || !prefix.startsWith("a")) {
        return undefined
      }

      const items = words
        .filter((word) => word.startsWith(prefix))
        .map((word) => ({
          id: word,
          label: word,
          insertText: word,
          detail: `${word.length} chars`,
        }))
      if (items.length === 0) {
        return undefined
      }

      return {
        replace: docCharRange(cursor - prefix.length, cursor),
        items,
      }
    },
  }
}
