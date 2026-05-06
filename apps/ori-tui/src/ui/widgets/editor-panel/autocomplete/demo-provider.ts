import type { BufferAutocompleteProvider } from "@ui/components/buffer"
import { docCharRange } from "@ui/components/buffer/coords"

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
    getCompletions: async ({ text, cursor, signal }) => {
      if (signal.aborted) {
        return undefined
      }

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
          description: `${word.length} chars`,
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
