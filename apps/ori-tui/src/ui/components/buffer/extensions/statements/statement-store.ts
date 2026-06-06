import { buildLineStarts, offsetToLine } from "@utils/line-offsets"
import type { BufferTextareaVisualLayout } from "../../buffer-textarea-adapter"
import { type DocCharOffset, docCharOffset, type LineIndex, lineIndex } from "../../coords"
import type { BufferTextChange, Document } from "../../document"
import type { ViewportSnapshot } from "../../viewport-snapshot"
import type { CollectStatements, StatementEntry, StatementRange, StatementSnapshot } from "./statement-types"

function buildStatementLineMap(entries: readonly StatementRange[], lineCount: number) {
  const lines = Array.from({ length: lineCount }, () => -1)
  entries.forEach((entry, index) => {
    for (let line = Number(entry.startLine); line <= entry.endLine; line += 1) {
      lines[line] = index
    }
  })
  return lines
}

function readEntryText(text: string, entry: StatementRange) {
  return text.slice(entry.start, entry.end)
}

function matchesEntryText(previousText: string, previous: StatementRange, nextText: string, next: StatementRange) {
  return readEntryText(previousText, previous) === readEntryText(nextText, next)
}

function hasExactEntryRange(previous: StatementRange, next: StatementRange) {
  return previous.start === next.start && previous.end === next.end
}

function hasShiftedEntryRange(previous: StatementRange, next: StatementRange, delta: number) {
  return previous.start + delta === next.start && previous.end + delta === next.end
}

function touchesChangeWindow(entry: StatementRange, start: DocCharOffset, end: DocCharOffset) {
  if (start === end) {
    return entry.start <= start && start <= entry.end
  }

  return entry.start < end && start < entry.end
}

function stablePrefixCount(
  previous: readonly StatementEntry[],
  previousText: string,
  next: readonly StatementRange[],
  nextText: string,
) {
  let count = 0
  for (; count < previous.length && count < next.length; count += 1) {
    const entry = previous[count]
    const query = next[count]
    if (!entry || !query) {
      break
    }
    if (!matchesEntryText(previousText, entry, nextText, query)) {
      break
    }
  }
  return count
}

function stableSuffixCount(
  previous: readonly StatementEntry[],
  previousText: string,
  next: readonly StatementRange[],
  prefix: number,
  nextText: string,
) {
  let count = 0
  for (; count < previous.length - prefix && count < next.length - prefix; count += 1) {
    const entry = previous[previous.length - 1 - count]
    const query = next[next.length - 1 - count]
    if (!entry || !query) {
      break
    }
    if (!matchesEntryText(previousText, entry, nextText, query)) {
      break
    }
  }
  return count
}

function buildReusedEntry(entry: StatementEntry, range: StatementRange): StatementEntry {
  return {
    ...range,
    id: entry.id,
  }
}

function buildChangedEntry(params: {
  previousEntry: StatementEntry | undefined
  range: StatementRange
  nextId: () => string
}) {
  return {
    ...params.range,
    id: params.previousEntry?.id ?? params.nextId(),
  } satisfies StatementEntry
}

function matchStatementEntries(params: {
  previous: readonly StatementEntry[]
  previousText: string
  ranges: readonly StatementRange[]
  text: string
  nextId: () => string
}) {
  const prefix = stablePrefixCount(params.previous, params.previousText, params.ranges, params.text)
  const suffix = stableSuffixCount(params.previous, params.previousText, params.ranges, prefix, params.text)
  const entries = new Array<StatementEntry>(params.ranges.length)

  for (let index = 0; index < prefix; index += 1) {
    const range = params.ranges[index]
    const entry = params.previous[index]
    if (!range || !entry) {
      continue
    }
    entries[index] = buildReusedEntry(entry, range)
  }

  const middlePreviousStart = prefix
  const middlePreviousEnd = params.previous.length - suffix
  const middleNextEnd = params.ranges.length - suffix
  const middlePreviousCount = middlePreviousEnd - middlePreviousStart
  for (let index = prefix; index < middleNextEnd; index += 1) {
    const range = params.ranges[index]
    if (!range) {
      continue
    }
    const previousOffset = index - prefix
    const previousEntry =
      previousOffset < middlePreviousCount ? params.previous[middlePreviousStart + previousOffset] : undefined
    entries[index] = buildChangedEntry({
      previousEntry,
      range,
      nextId: params.nextId,
    })
  }

  for (let offset = suffix; offset > 0; offset -= 1) {
    const index = params.ranges.length - offset
    const range = params.ranges[index]
    const entry = params.previous[middlePreviousEnd + (index - middleNextEnd)]
    if (!range || !entry) {
      continue
    }
    entries[index] = buildReusedEntry(entry, range)
  }

  return entries
}

function matchIncrementalStatementEntries(params: {
  previous: readonly StatementEntry[]
  previousText: string
  ranges: readonly StatementRange[]
  text: string
  nextId: () => string
  change: BufferTextChange
}) {
  const delta = params.change.nextEnd - params.change.previousEnd
  const entries = new Array<StatementEntry>(params.ranges.length)
  let prefix = 0

  for (; prefix < params.previous.length && prefix < params.ranges.length; prefix += 1) {
    const entry = params.previous[prefix]
    const range = params.ranges[prefix]
    if (!entry || !range) {
      break
    }
    if (entry.end > params.change.start) {
      break
    }
    if (!hasExactEntryRange(entry, range)) {
      break
    }
    if (!matchesEntryText(params.previousText, entry, params.text, range)) {
      break
    }

    entries[prefix] = buildReusedEntry(entry, range)
  }

  let suffix = 0
  for (; suffix < params.previous.length - prefix && suffix < params.ranges.length - prefix; suffix += 1) {
    const previousIndex = params.previous.length - 1 - suffix
    const nextIndex = params.ranges.length - 1 - suffix
    const entry = params.previous[previousIndex]
    const range = params.ranges[nextIndex]
    if (!entry || !range) {
      break
    }
    if (entry.start < params.change.previousEnd || range.start < params.change.nextEnd) {
      break
    }
    if (!hasShiftedEntryRange(entry, range, delta)) {
      break
    }
    if (!matchesEntryText(params.previousText, entry, params.text, range)) {
      break
    }

    entries[nextIndex] = buildReusedEntry(entry, range)
  }

  const middlePreviousEnd = params.previous.length - suffix
  const middleNextEnd = params.ranges.length - suffix
  let middleStart = prefix
  const middleEntry = prefix < middlePreviousEnd ? params.previous[prefix] : undefined
  const middleRange = prefix < middleNextEnd ? params.ranges[prefix] : undefined
  const canReuseChangedEntry =
    !!middleEntry &&
    !!middleRange &&
    touchesChangeWindow(middleEntry, params.change.start, params.change.previousEnd) &&
    touchesChangeWindow(middleRange, params.change.start, params.change.nextEnd)

  if (canReuseChangedEntry && middleEntry && middleRange) {
    entries[prefix] = buildChangedEntry({
      previousEntry: middleEntry,
      range: middleRange,
      nextId: params.nextId,
    })
    middleStart += 1
  }

  for (let index = middleStart; index < middleNextEnd; index += 1) {
    const range = params.ranges[index]
    if (!range) {
      continue
    }

    entries[index] = buildChangedEntry({
      previousEntry: undefined,
      range,
      nextId: params.nextId,
    })
  }

  return entries
}

function resolveIncrementalReparseStart(previous: readonly StatementEntry[], changeStart: DocCharOffset) {
  let index = -1

  for (let i = 0; i < previous.length; i += 1) {
    const entry = previous[i]
    if (!entry) {
      continue
    }
    if (entry.start > changeStart) {
      break
    }
    index = i
  }

  if (index < 0) {
    return {
      prefixCount: 0,
      startOffset: docCharOffset(0),
    }
  }

  return {
    prefixCount: index,
    startOffset: previous[index]?.start ?? docCharOffset(0),
  }
}

function collectIncrementalRanges(
  text: string,
  lineStarts: readonly DocCharOffset[],
  startOffset: DocCharOffset,
  collectStatements: CollectStatements,
) {
  if (startOffset <= 0) {
    return collectStatements(text, lineStarts)
  }

  const tailText = text.slice(startOffset)
  const tailLineStarts = buildLineStarts(tailText).map(docCharOffset)
  const baseLine = offsetToLine(startOffset, lineStarts)
  return collectStatements(tailText, tailLineStarts).map((range) => ({
    start: docCharOffset(range.start + startOffset),
    end: docCharOffset(range.end + startOffset),
    startLine: lineIndex(range.startLine + baseLine),
    endLine: lineIndex(range.endLine + baseLine),
  }))
}

function buildIncrementalEntries(params: {
  text: string
  lineStarts: readonly DocCharOffset[]
  previous: readonly StatementEntry[]
  previousText: string
  nextId: () => string
  change: BufferTextChange
  collectStatements: CollectStatements
}) {
  const start = resolveIncrementalReparseStart(params.previous, params.change.start)
  const prefix = params.previous.slice(0, start.prefixCount).map((entry) => buildReusedEntry(entry, entry))
  const tail = matchIncrementalStatementEntries({
    previous: params.previous.slice(start.prefixCount),
    previousText: params.previousText,
    ranges: collectIncrementalRanges(params.text, params.lineStarts, start.startOffset, params.collectStatements),
    text: params.text,
    nextId: params.nextId,
    change: params.change,
  })

  return [...prefix, ...tail]
}

function buildStatementSnapshot(params: {
  document: Document
  previous: readonly StatementEntry[]
  previousText: string
  nextId: () => string
  change: BufferTextChange | undefined
  collectStatements: CollectStatements
}): StatementSnapshot {
  const text = params.document.text
  const lineStarts = params.document.lineStarts
  const entries =
    params.change && params.previous.length > 0
      ? buildIncrementalEntries({
          text,
          lineStarts,
          previous: params.previous,
          previousText: params.previousText,
          nextId: params.nextId,
          change: params.change,
          collectStatements: params.collectStatements,
        })
      : matchStatementEntries({
          previous: params.previous,
          previousText: params.previousText,
          ranges: params.collectStatements(text, lineStarts),
          text,
          nextId: params.nextId,
        })

  return {
    version: params.document.version,
    entries,
    lineToStatement: buildStatementLineMap(entries, lineStarts.length),
  }
}

function collectVisibleStatementIndices(
  snapshot: StatementSnapshot | undefined,
  layout: BufferTextareaVisualLayout,
  scrollY: number,
  height: number,
  focusedRow: LineIndex,
  overscan: number,
) {
  if (!snapshot) {
    return [] as number[]
  }

  const startRow = Math.max(0, scrollY - overscan)
  const endRow = Math.min(layout.sourceLines.length, scrollY + height + overscan)
  const seen = new Set<number>()
  const indices: number[] = []
  const pushIndex = (index: number | undefined) => {
    if (index === undefined || index < 0 || seen.has(index)) {
      return
    }

    seen.add(index)
    indices.push(index)
  }

  for (let row = startRow; row < endRow; row += 1) {
    const line = layout.sourceLines[row]
    if (line === undefined) {
      continue
    }
    pushIndex(snapshot.lineToStatement[line])
  }

  pushIndex(snapshot.lineToStatement[focusedRow])
  return indices
}

export function createStatementStore(params: { collectStatements: CollectStatements; nextId: () => string }) {
  let snapshot: StatementSnapshot | undefined
  let previousEntries: StatementEntry[] = []
  let previousText = ""

  const update = (document: Document, change: BufferTextChange | undefined) => {
    snapshot = buildStatementSnapshot({
      document,
      previous: previousEntries,
      previousText,
      nextId: params.nextId,
      change,
      collectStatements: params.collectStatements,
    })
    previousEntries = snapshot.entries
    previousText = document.text
    return snapshot
  }

  const reset = () => {
    snapshot = undefined
    previousEntries = []
    previousText = ""
  }

  return {
    read: () => snapshot,
    update,
    reset,
    collectVisibleIndices: (viewport: ViewportSnapshot, overscan: number) =>
      collectVisibleStatementIndices(
        snapshot,
        viewport.layout,
        viewport.scrollY,
        viewport.height,
        viewport.focusedLine,
        overscan,
      ),
  }
}
