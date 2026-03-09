export type LineCol = {
  line: number
  col: number
}

export function buildLineStarts(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      starts.push(i + 1)
    }
  }
  return starts
}

export function offsetToLineCol(offset: number, starts: number[]): LineCol {
  let low = 0
  let high = starts.length - 1
  while (low <= high) {
    const mid = (low + high) >> 1
    const start = starts[mid]
    const next = mid + 1 < starts.length ? starts[mid + 1] : Number.POSITIVE_INFINITY
    if (offset < start) {
      high = mid - 1
      continue
    }
    if (offset >= next) {
      low = mid + 1
      continue
    }
    return { line: mid, col: offset - start }
  }
  return { line: starts.length - 1, col: 0 }
}

export function offsetToLine(offset: number, starts: number[]): number {
  return offsetToLineCol(offset, starts).line
}
