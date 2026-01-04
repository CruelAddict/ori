/* This will hopfully be replaced once we get proper access to treesitter */

export type SqlStatement = {
  startLine: number;
  endLine: number;
};

type Span = { start: number; end: number };

type ParseState =
  | { kind: "normal" }
  | { kind: "line-comment" }
  | { kind: "block-comment" }
  | { kind: "single-quote" }
  | { kind: "double-quote" }
  | { kind: "dollar-quote"; tag: string };

const WHITESPACE_RE = /\s/;

const SQL_START_KEYWORDS = new Set(
  [
    "with",
    "select",
    "insert",
    "update",
    "delete",
    "create",
    "alter",
    "drop",
    "truncate",
    "begin",
    "commit",
    "rollback",
    "grant",
    "revoke",
    "call",
    "explain",
    "analyze",
    "show",
    "describe",
  ].map((word) => word.toLowerCase()),
);

function offsetToLine(offset: number, lineStarts: number[]): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const start = lineStarts[mid];
    const nextStart = mid + 1 < lineStarts.length ? lineStarts[mid + 1] : Number.POSITIVE_INFINITY;
    if (offset < start) {
      high = mid - 1;
    } else if (offset >= nextStart) {
      low = mid + 1;
    } else {
      return mid;
    }
  }
  return lineStarts.length - 1;
}

function startsDollarTag(text: string, index: number): string | undefined {
  if (text[index] !== "$") {
    return undefined;
  }
  let j = index + 1;
  while (j < text.length && /[A-Za-z0-9_]/.test(text[j])) {
    j++;
  }
  if (text[j] !== "$") {
    return undefined;
  }
  return text.slice(index, j + 1);
}

function findStatementTokenStart(text: string, span: Span): number | undefined {
  let i = span.start;

  while (i < span.end) {
    while (i < span.end && WHITESPACE_RE.test(text[i]!)) {
      i++;
    }

    if (text.startsWith("--", i)) {
      i += 2;
      while (i < span.end && text[i] !== "\n") {
        i++;
      }
      continue;
    }

    if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      if (end === -1 || end + 2 > span.end) {
        return undefined;
      }
      i = end + 2;
      continue;
    }

    if (text[i] === ";") {
      i++;
      continue;
    }

    break;
  }

  return i < span.end ? i : undefined;
}

function getLeadingToken(text: string, span: Span): { tokenStart: number; token: string } | undefined {
  const tokenStart = findStatementTokenStart(text, span);
  if (tokenStart === undefined) {
    return undefined;
  }
  const tokenMatch = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(text.slice(tokenStart, span.end));
  if (!tokenMatch) {
    return undefined;
  }
  return { tokenStart, token: tokenMatch[0]!.toLowerCase() };
}

function hasNonWhitespace(text: string, start: number, end: number): boolean {
  for (let i = start; i < end; i++) {
    if (!WHITESPACE_RE.test(text[i]!)) {
      return true;
    }
  }
  return false;
}

function findLikelyKeywordAfterNewline(text: string, start: number, end: number): number | undefined {
  let i = start;
  let sawIndent = false;
  while (i < end && WHITESPACE_RE.test(text[i]!)) {
    if (text[i] === "\n") {
      return undefined;
    }
    sawIndent = true;
    i++;
  }
  if (sawIndent || i >= end) {
    return undefined;
  }
  const tokenMatch = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(text.slice(i, end));
  if (!tokenMatch) {
    return undefined;
  }
  const token = tokenMatch[0]?.toLowerCase();
  if (!token || !SQL_START_KEYWORDS.has(token)) {
    return undefined;
  }
  return i;
}

function collectStatementSpans(text: string): Span[] {
  const segments: Span[] = [];
  const spanEnd = text.length;
  let segmentStart = 0;
  let state: ParseState = { kind: "normal" };
  let leadingToken = getLeadingToken(text, { start: segmentStart, end: spanEnd });
  let allowWithContinuation = leadingToken?.token === "with";

  let i = 0;
  while (i < spanEnd) {
    const ch = text[i];
    const next = text[i + 1];

    if (state.kind === "normal") {
      if (ch === "-" && next === "-") {
        state = { kind: "line-comment" };
        i += 2;
        continue;
      }
      if (ch === "/" && next === "*") {
        state = { kind: "block-comment" };
        i += 2;
        continue;
      }
      if (ch === "'" || ((ch === "E" || ch === "e") && next === "'")) {
        state = { kind: "single-quote" };
        i += ch === "'" ? 1 : 2;
        continue;
      }
      if (ch === '"') {
        state = { kind: "double-quote" };
        i++;
        continue;
      }
      const tag = startsDollarTag(text, i);
      if (tag) {
        state = { kind: "dollar-quote", tag };
        i += tag.length;
        continue;
      }
      if (ch === ";") {
        const trimmed = trimSpan(text, { start: segmentStart, end: i + 1 });
        if (trimmed) {
          segments.push(trimmed);
        }
        segmentStart = i + 1;
        leadingToken = getLeadingToken(text, { start: segmentStart, end: spanEnd });
        allowWithContinuation = leadingToken?.token === "with";
        i++;
        continue;
      }
      if (ch === "\n") {
        const nextStart = findLikelyKeywordAfterNewline(text, i + 1, spanEnd);
        if (nextStart !== undefined && hasNonWhitespace(text, segmentStart, nextStart)) {
          if (leadingToken?.token === "with" && allowWithContinuation) {
            allowWithContinuation = false;
            i++;
            continue;
          }
          const trimmed = trimSpan(text, { start: segmentStart, end: nextStart });
          if (trimmed) {
            segments.push(trimmed);
          }
          segmentStart = nextStart;
          leadingToken = getLeadingToken(text, { start: segmentStart, end: spanEnd });
          allowWithContinuation = leadingToken?.token === "with";
          i = nextStart;
          continue;
        }
      }
      i++;
      continue;
    }

    if (state.kind === "line-comment") {
      if (ch === "\n") {
        state = { kind: "normal" };
      }
      i++;
      continue;
    }

    if (state.kind === "block-comment") {
      if (ch === "*" && next === "/") {
        state = { kind: "normal" };
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    if (state.kind === "single-quote") {
      if (ch === "'" && next === "'") {
        i += 2;
        continue;
      }
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === "'") {
        state = { kind: "normal" };
        i++;
        continue;
      }
      i++;
      continue;
    }

    if (state.kind === "double-quote") {
      if (ch === '"' && next === '"') {
        i += 2;
        continue;
      }
      if (ch === '"') {
        state = { kind: "normal" };
        i++;
        continue;
      }
      i++;
      continue;
    }

    if (state.kind === "dollar-quote") {
      if (text.startsWith(state.tag, i)) {
        const tag = state.tag;
        state = { kind: "normal" };
        i += tag.length;
        continue;
      }
      i++;
      continue;
    }
  }

  const tail = trimSpan(text, { start: segmentStart, end: spanEnd });
  if (tail) {
    segments.push(tail);
  }

  return segments;
}

function trimSpan(text: string, span: Span): Span | undefined {
  let start = span.start;
  let end = span.end;

  while (start < end && WHITESPACE_RE.test(text[start]!)) {
    start++;
  }
  while (end > start && WHITESPACE_RE.test(text[end - 1]!)) {
    end--;
  }
  if (start >= end) {
    return undefined;
  }
  return { start, end };
}

export function collectSqlStatements(text: string, lineStarts: number[]): SqlStatement[] {
  if (!text.length) {
    return [];
  }
  const logicalSpans = collectStatementSpans(text);
  const result: SqlStatement[] = [];

  for (const logical of logicalSpans) {
    const leadingToken = getLeadingToken(text, logical);
    if (!leadingToken || !SQL_START_KEYWORDS.has(leadingToken.token)) {
      continue;
    }

    const startLine = offsetToLine(leadingToken.tokenStart, lineStarts);
    const endLine = offsetToLine(logical.end - 1, lineStarts);

    result.push({
      startLine,
      endLine,
    });
  }

  return result;
}
