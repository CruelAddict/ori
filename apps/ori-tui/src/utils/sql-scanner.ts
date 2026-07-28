export type SqlToken = {
  kind: "word" | "semicolon" | "newline" | "open-paren" | "close-paren" | "code"
  start: number
  end: number
  depth: number
  value?: string
}

export type SqlScan = {
  tokens: readonly SqlToken[]
  firstKeyword?: string
  hasMultipleStatements: boolean
  terminatorIndex?: number
  topLevelKeywords: ReadonlySet<string>
}

export function scanSql(text: string): SqlScan {
  const tokens: SqlToken[] = []
  const topLevelKeywords = new Set<string>()
  let index = 0
  let depth = 0
  let firstKeyword: string | undefined
  let terminatorIndex: number | undefined
  let hasMultipleStatements = false

  const push = (kind: SqlToken["kind"], start: number, end: number, value?: string) => {
    tokens.push({ kind, start, end, depth, value })
  }

  for (; index < text.length; ) {
    const char = text[index]!
    const next = text[index + 1]

    if (char === "-" && next === "-") {
      index = skipLineComment(text, index + 2)
      continue
    }
    if (char === "/" && next === "*") {
      index = skipBlockComment(text, index + 2)
      continue
    }
    if (char === "'" || ((char === "E" || char === "e") && next === "'")) {
      const start = index
      const isEscaped = char === "E" || char === "e"
      index = skipQuoted(text, index + (isEscaped ? 2 : 1), "'", isEscaped)
      push("code", start, index)
      continue
    }
    if (char === '"' || char === "`") {
      const start = index
      index = skipQuoted(text, index + 1, char, false)
      push("code", start, index)
      continue
    }
    // TODO: support dialect-aware bracket-quoted identifiers for SQLite/SQL Server.
    // PostgreSQL arrays and DuckDB lists also use brackets, so they are ordinary SQL here.
    if (char === "$") {
      const end = skipDollarQuoted(text, index)
      if (end !== index) {
        push("code", index, end)
        index = end
        continue
      }
    }
    if (char === "(") {
      push("open-paren", index, index + 1)
      depth += 1
      index += 1
      continue
    }
    if (char === ")") {
      depth = Math.max(0, depth - 1)
      push("close-paren", index, index + 1)
      index += 1
      continue
    }
    if (char === ";") {
      push("semicolon", index, index + 1)
      if (terminatorIndex === undefined) {
        terminatorIndex = index
      } else {
        hasMultipleStatements = true
      }
      depth = 0
      index += 1
      continue
    }
    if (char === "\n") {
      push("newline", index, index + 1)
      index += 1
      continue
    }
    if (isWhitespace(char)) {
      index += 1
      continue
    }
    if (isWordStart(char)) {
      const start = index
      index += 1
      for (; index < text.length && isWordPart(text[index]); index += 1) {}
      const value = text.slice(start, index).toLowerCase()
      push("word", start, index, value)
      if (depth === 0) {
        firstKeyword ??= value
        topLevelKeywords.add(value)
        if (terminatorIndex !== undefined) {
          hasMultipleStatements = true
        }
      }
      continue
    }

    push("code", index, index + 1)
    if (depth === 0 && terminatorIndex !== undefined) {
      hasMultipleStatements = true
    }
    index += 1
  }

  return { tokens, firstKeyword, hasMultipleStatements, terminatorIndex, topLevelKeywords }
}

function skipLineComment(text: string, index: number): number {
  for (; index < text.length && text[index] !== "\n"; index += 1) {}
  return index
}

function skipBlockComment(text: string, index: number): number {
  for (; index + 1 < text.length; index += 1) {
    if (text[index] === "*" && text[index + 1] === "/") {
      return index + 2
    }
  }
  return text.length
}

function skipQuoted(text: string, index: number, quote: string, backslashEscapes: boolean): number {
  for (; index < text.length; index += 1) {
    if (backslashEscapes && text[index] === "\\") {
      index += 1
      continue
    }
    if (text[index] !== quote) {
      continue
    }
    if (text[index + 1] === quote) {
      index += 1
      continue
    }
    return index + 1
  }
  return text.length
}

function skipDollarQuoted(text: string, index: number): number {
  if (text[index] !== "$") {
    return index
  }
  let tagEnd = index + 1
  if (text[tagEnd] === "$") {
    tagEnd += 1
  } else {
    if (!isWordStart(text[tagEnd])) {
      return index
    }
    tagEnd += 1
    while (isWordStart(text[tagEnd]) || (text[tagEnd] !== undefined && text[tagEnd]! >= "0" && text[tagEnd]! <= "9")) {
      tagEnd += 1
    }
    if (text[tagEnd] !== "$") {
      return index
    }
    tagEnd += 1
  }
  const tag = text.slice(index, tagEnd)
  const closingStart = text.indexOf(tag, index + tag.length)
  return closingStart === -1 ? text.length : closingStart + tag.length
}

function isWhitespace(char: string | undefined): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\v" || char === "\f"
}

function isWordStart(char: string | undefined): boolean {
  if (!char) {
    return false
  }
  return (char >= "a" && char <= "z") || (char >= "A" && char <= "Z") || char === "_"
}

function isWordPart(char: string | undefined): boolean {
  if (!char) {
    return false
  }
  return isWordStart(char) || (char >= "0" && char <= "9") || char === "$"
}
