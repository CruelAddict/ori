const MIN_SHARED_STATEMENT_COVERAGE = 0.8

type HighlightSpan = {
  start: number
  end: number
  styleId: number
}

type ChangedStatementReuseInput = {
  previousText: string
  nextText: string
  previousSpans: readonly HighlightSpan[]
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

export function shouldReuseChangedStatementSpans(previousText: string, nextText: string) {
  if (previousText === nextText) {
    return true
  }

  const shorter = Math.min(previousText.length, nextText.length)
  if (shorter === 0) {
    return false
  }

  const prefix = sharedPrefixCount(previousText, nextText)
  const suffix = sharedSuffixCount(previousText, nextText, prefix)
  const shared = Math.min(shorter, prefix + suffix)

  return shared / shorter >= MIN_SHARED_STATEMENT_COVERAGE
}

function isTouchedSpan(span: HighlightSpan, start: number, end: number) {
  if (start === end) {
    return span.start <= start && start < span.end
  }

  return span.start < end && span.end > start
}

function isSafeInnerChange(span: HighlightSpan, start: number, end: number) {
  if (start === end) {
    return span.start < start && start < span.end
  }

  return span.start < start && end < span.end
}

export function buildChangedStatementReuse(input: ChangedStatementReuseInput) {
  if (input.previousText === input.nextText) {
    return {
      spans: input.previousSpans.map((span) => ({ ...span })),
    }
  }

  const prefix = sharedPrefixCount(input.previousText, input.nextText)
  const suffix = sharedSuffixCount(input.previousText, input.nextText, prefix)
  const previousEnd = input.previousText.length - suffix
  const delta = input.nextText.length - input.previousText.length
  const spans: HighlightSpan[] = []

  for (const span of input.previousSpans) {
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

  return { spans }
}
