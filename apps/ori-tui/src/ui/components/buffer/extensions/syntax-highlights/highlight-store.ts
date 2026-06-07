import type { SyntaxHighlightSpan } from "@utils/syntax-highlighter"
import type { Document } from "../../document"
import type { StatementEntry, StatementSnapshot } from "../statements/statement-types"

type LocalHighlightSpan = {
  start: number
  end: number
  styleId: number
}

export type HighlightEntry = StatementEntry & {
  spans: SyntaxHighlightSpan[]
  dirty: boolean
  highlightVersion: number
}

export type HighlightSnapshot = {
  entries: HighlightEntry[]
  lineToStatements: readonly number[][]
}

export type HighlightBatch = {
  startIndex: number
  endIndex: number
  startOffset: StatementEntry["start"]
  text: string
}

function sharedPrefixCount(previousText: string, nextText: string) {
  const limit = Math.min(previousText.length, nextText.length)
  let count = 0

  for (; count < limit; count += 1) {
    if (previousText[count] !== nextText[count]) {
      return count
    }
  }

  return count
}

function sharedSuffixCount(previousText: string, nextText: string, prefix: number) {
  const limit = Math.min(previousText.length, nextText.length) - prefix
  let count = 0

  for (; count < limit; count += 1) {
    if (previousText[previousText.length - 1 - count] !== nextText[nextText.length - 1 - count]) {
      return count
    }
  }

  return count
}

function isTouchedSpan(span: LocalHighlightSpan, start: number, end: number) {
  if (start === end) {
    return span.start < start && start < span.end
  }

  return span.start < end && span.end > start
}

function isSafeInnerChange(span: LocalHighlightSpan, start: number, end: number) {
  if (start === end) {
    return span.start < start && start < span.end
  }

  return span.start < start && end < span.end
}

function buildChangedStatementSpans(params: {
  previousText: string
  nextText: string
  previousSpans: readonly LocalHighlightSpan[]
}) {
  if (params.previousText === params.nextText) {
    return params.previousSpans.map((span) => ({ ...span }))
  }

  const prefix = sharedPrefixCount(params.previousText, params.nextText)
  const suffix = sharedSuffixCount(params.previousText, params.nextText, prefix)
  const previousEnd = params.previousText.length - suffix
  const delta = params.nextText.length - params.previousText.length
  const spans: LocalHighlightSpan[] = []

  for (const span of params.previousSpans) {
    if (isTouchedSpan(span, prefix, previousEnd)) {
      if (isSafeInnerChange(span, prefix, previousEnd)) {
        spans.push({ start: span.start, end: span.end + delta, styleId: span.styleId })
      }
      continue
    }

    if (span.end <= prefix) {
      spans.push({ ...span })
      continue
    }

    if (span.start >= previousEnd) {
      spans.push({ start: span.start + delta, end: span.end + delta, styleId: span.styleId })
    }
  }

  return spans
}

function shiftSpans(spans: readonly SyntaxHighlightSpan[], delta: number) {
  if (delta === 0) {
    return [...spans]
  }

  return spans.map((span) => ({
    start: span.start + delta,
    end: span.end + delta,
    styleId: span.styleId,
  }))
}

function localizeSpans(spans: readonly SyntaxHighlightSpan[], start: number) {
  return spans.map((span) => ({
    start: span.start - start,
    end: span.end - start,
    styleId: span.styleId,
  }))
}

function absolutizeSpans(spans: readonly SyntaxHighlightSpan[], start: number) {
  return spans.map((span) => ({
    start: span.start + start,
    end: span.end + start,
    styleId: span.styleId,
  }))
}

function nextHighlightVersion(
  entry: HighlightEntry | undefined,
  nextStart: StatementEntry["start"],
  textChanged: boolean,
) {
  if (!entry) {
    return 0
  }
  if (textChanged || entry.start !== nextStart) {
    return entry.highlightVersion + 1
  }

  return entry.highlightVersion
}

function needsHighlight(entry: HighlightEntry | undefined) {
  if (!entry) {
    return true
  }
  if (entry.dirty) {
    return true
  }

  return entry.highlightVersion === 0 && entry.spans.length === 0
}

function buildHighlightEntry(params: {
  entry: StatementEntry
  previous: HighlightEntry | undefined
  previousText: string
  text: string
}) {
  if (!params.previous) {
    return {
      ...params.entry,
      spans: [],
      dirty: true,
      highlightVersion: 0,
    } satisfies HighlightEntry
  }

  const previousText = params.previousText.slice(params.previous.start, params.previous.end)
  const nextText = params.text.slice(params.entry.start, params.entry.end)
  const textChanged = previousText !== nextText
  const spans = textChanged
    ? absolutizeSpans(
        buildChangedStatementSpans({
          previousText,
          nextText,
          previousSpans: localizeSpans(params.previous.spans, params.previous.start),
        }),
        params.entry.start,
      )
    : shiftSpans(params.previous.spans, params.entry.start - params.previous.start)

  return {
    ...params.entry,
    spans,
    dirty: textChanged || needsHighlight(params.previous),
    highlightVersion: nextHighlightVersion(params.previous, params.entry.start, textChanged),
  } satisfies HighlightEntry
}

export function createHighlightStore() {
  let snapshot: HighlightSnapshot | undefined
  let previousEntries: HighlightEntry[] = []
  let previousText = ""

  const reset = () => {
    snapshot = undefined
    previousEntries = []
    previousText = ""
  }

  const sync = (statements: StatementSnapshot | undefined, document: Document) => {
    if (!statements) {
      reset()
      return undefined
    }

    const previousById = new Map(previousEntries.map((entry) => [entry.id, entry]))
    const entries = statements.entries.map((entry) =>
      buildHighlightEntry({
        entry,
        previous: previousById.get(entry.id),
        previousText,
        text: document.text,
      }),
    )
    snapshot = {
      entries,
      lineToStatements: statements.lineToStatements,
    }
    previousEntries = entries
    previousText = document.text
    return snapshot
  }

  const applyBatch = (batch: HighlightBatch, spans: readonly SyntaxHighlightSpan[]) => {
    if (!snapshot) {
      return
    }

    for (let index = batch.startIndex; index <= batch.endIndex; index += 1) {
      const entry = snapshot.entries[index]
      if (!entry) {
        continue
      }

      const nextSpans: SyntaxHighlightSpan[] = []
      for (const span of spans) {
        const absoluteStart = batch.startOffset + span.start
        const absoluteEnd = batch.startOffset + span.end
        const start = Math.max(absoluteStart, entry.start)
        const end = Math.min(absoluteEnd, entry.end)
        if (end <= start) {
          continue
        }

        nextSpans.push({
          start: start - entry.start,
          end: end - entry.start,
          styleId: span.styleId,
        })
      }

      entry.spans = nextSpans.map((span) => ({
        start: span.start + entry.start,
        end: span.end + entry.start,
        styleId: span.styleId,
      }))
      entry.dirty = false
      entry.highlightVersion += 1
    }
  }

  const buildBatch = (document: Document, startIndex: number, endIndex: number) => {
    if (!snapshot) {
      return undefined
    }

    const first = snapshot.entries[startIndex]
    const last = snapshot.entries[endIndex]
    if (!first || !last || startIndex > endIndex) {
      return undefined
    }

    return {
      startIndex,
      endIndex,
      startOffset: first.start,
      text: document.text.slice(first.start, last.end),
    } satisfies HighlightBatch
  }

  return {
    read: () => snapshot,
    reset,
    sync,
    hasDirty: () => snapshot?.entries.some((entry) => entry.dirty) ?? false,
    applyBatch,
    buildBatch,
  }
}
