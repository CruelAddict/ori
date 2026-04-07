declare const coordBrand: unique symbol

type Coord<Name extends string> = number & { readonly [coordBrand]: Name }

/** Zero-based line index in the buffer document. */
export type LineIndex = Coord<"LineIndex">

/** Absolute character offset in the full buffer text. */
export type DocCharOffset = Coord<"DocCharOffset">

/** Character offset inside a single line string. */
export type LineCharOffset = Coord<"LineCharOffset">

/**
 * Display-space column for a single line.
 * E.g. tabs are already expanded in this coordinate space.
 * Does NOT take line-wrap into account.
 */
export type DisplayColumn = Coord<"DisplayColumn">

/** Zero-based wrapped row inside a rendered line. */
export type VisualRow = Coord<"VisualRow">

/** Zero-based visual column inside a wrapped row. */
export type VisualColumn = Coord<"VisualColumn">

/** X coordinate relative to a container. */
export type ContainerX = Coord<"ContainerX">

/** Y coordinate relative to a container. */
export type ContainerY = Coord<"ContainerY">

/** A line-local character position. */
export type LineCharPosition = {
  line: LineIndex
  offset: LineCharOffset
}

/** A document range in absolute character offsets. */
export type DocCharRange = {
  start: DocCharOffset
  end: DocCharOffset
}

/** A line-local range in character offsets. */
export type LineCharRange = {
  start: LineCharOffset
  end: LineCharOffset
}

/** Current cursor location as exposed by the buffer model. */
export type BufferCursor = {
  line: LineIndex
  /** Caret column in OpenTUI's line-global display space. */
  displayCol: DisplayColumn
  /** Wrapped row inside the focused textarea line. */
  row: number
}

export function lineIndex(value: number): LineIndex {
  return value as LineIndex
}

export function docCharOffset(value: number): DocCharOffset {
  return value as DocCharOffset
}

export function lineCharOffset(value: number): LineCharOffset {
  return value as LineCharOffset
}

export function displayColumn(value: number): DisplayColumn {
  return value as DisplayColumn
}

export function visualRow(value: number): VisualRow {
  return value as VisualRow
}

export function visualColumn(value: number): VisualColumn {
  return value as VisualColumn
}

export function containerX(value: number): ContainerX {
  return value as ContainerX
}

export function containerY(value: number): ContainerY {
  return value as ContainerY
}

export function lineCharPosition(line: number, offset: number): LineCharPosition {
  return {
    line: lineIndex(line),
    offset: lineCharOffset(offset),
  }
}

export function docCharRange(start: number, end: number): DocCharRange {
  return {
    start: docCharOffset(start),
    end: docCharOffset(end),
  }
}

export function lineCharRange(start: number, end: number): LineCharRange {
  return {
    start: lineCharOffset(start),
    end: lineCharOffset(end),
  }
}

export function addDisplayColumn(col: DisplayColumn, delta: number): DisplayColumn {
  return displayColumn(col + delta)
}

export function clampDisplayColumn(col: DisplayColumn, max: DisplayColumn): DisplayColumn {
  return displayColumn(Math.min(col, max))
}
