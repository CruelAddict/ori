export type SqlStatementLines = {
  startLine: number;
  endLine: number;
  isLikelySql: boolean;
};

export type SqlStatementSpan = {
  startOffset: number;
  endOffset: number;
  startLine: number;
  endLine: number;
  isLikelySql: boolean;
};

export type FindSqlStatementAtCursorParams = {
  text: string;
  cursorLine: number;
  cursorCol: number;
  spans?: SqlStatementSpan[];
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

const LIKELY_SQL_KEYWORDS = new Set(
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

function buildLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      starts.push(i + 1);
    }
  }
  return starts;
}

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

function clampCursorToOffset(text: string, lineStarts: number[], line: number, col: number): number {
  const lineIndex = Math.max(0, Math.min(line, lineStarts.length - 1));
  const start = lineStarts[lineIndex];
  const nextStart = lineIndex + 1 < lineStarts.length ? lineStarts[lineIndex + 1] : text.length;
  const maxCol = Math.max(0, nextStart - start);
  const clampedCol = Math.max(0, Math.min(col, maxCol));
  return start + clampedCol;
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

function isLikelySqlStatement(text: string, span: Span): boolean {
  let i = span.start;
  while (i < span.end && WHITESPACE_RE.test(text[i]!)) {
    i++;
  }
  const tokenMatch = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(text.slice(i, span.end));
  if (!tokenMatch) {
    return false;
  }
  const token = tokenMatch[0]?.toLowerCase();
  return LIKELY_SQL_KEYWORDS.has(token);
}

function collectRawStatementSpans(text: string): Span[] {
  const spans: Span[] = [];
  let currentStart = 0;
  let state: ParseState = { kind: "normal" };

  let i = 0;
  while (i < text.length) {
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
        spans.push({ start: currentStart, end: i + 1 });
        currentStart = i + 1;
        i++;
        continue;
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

  if (currentStart < text.length) {
    spans.push({ start: currentStart, end: text.length });
  }

  return spans;
}

export function collectSqlStatements(text: string): SqlStatementSpan[] {
  if (!text.length) {
    return [];
  }
  const lineStarts = buildLineStarts(text);
  const rawSpans = collectRawStatementSpans(text);
  const result: SqlStatementSpan[] = [];
  for (const span of rawSpans) {
    const trimmed = trimSpan(text, span);
    if (!trimmed) {
      continue;
    }
    const startLine = offsetToLine(trimmed.start, lineStarts);
    const endLine = offsetToLine(trimmed.end - 1, lineStarts);
    result.push({
      startOffset: trimmed.start,
      endOffset: trimmed.end,
      startLine,
      endLine,
      isLikelySql: isLikelySqlStatement(text, trimmed),
    });
  }
  return result;
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

export function findSqlStatementAtCursor(params: FindSqlStatementAtCursorParams): SqlStatementLines | undefined {
  const { text, cursorLine, cursorCol, spans } = params;
  if (!text.length) {
    return undefined;
  }

  const lineStarts = buildLineStarts(text);
  const cursorOffset = clampCursorToOffset(text, lineStarts, cursorLine, cursorCol);

  const statementSpans = spans ?? collectSqlStatements(text);
  if (!statementSpans.length) {
    return undefined;
  }

  let target: SqlStatementSpan | undefined;
  let previous: SqlStatementSpan | undefined;
  for (const span of statementSpans) {
    if (cursorOffset >= span.startOffset && cursorOffset < span.endOffset) {
      target = span;
      break;
    }
    if (cursorOffset < span.startOffset) {
      target = previous && previous.isLikelySql ? previous : span;
      break;
    }
    previous = span;
  }
  if (!target) {
    target = statementSpans[statementSpans.length - 1];
  }

  if (!target.isLikelySql) {
    return undefined;
  }

  return { startLine: target.startLine, endLine: target.endLine, isLikelySql: true };
}
