const MIN_SHARED_STATEMENT_COVERAGE = 0.8

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
