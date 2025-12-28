import { getTreeSitterClient } from "@opentui/core";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Logger } from "pino";
import sqlWasm from "../../assets/tree-sitter-sql.wasm" with { type: "file" };
import sqlHighlights from "../../assets/highlights.scm" with { type: "file" };

export type SqlTokenKind = "keyword" | "string" | "number" | "comment" | "identifier" | "operator";

export type SqlHighlightSpan = {
  line: number;
  start: number;
  end: number;
  kind: SqlTokenKind;
};

type SimpleHighlight = [startIndex: number, endIndex: number, group: string];

type HighlightResult = {
  highlights?: SimpleHighlight[];
  warning?: string;
  error?: string;
};

const FILETYPE_SQL = "sql";
const ASSET_BASE = dirname(fileURLToPath(import.meta.url));
const SQL_WASM_PATH = resolve(ASSET_BASE, sqlWasm);
const SQL_HIGHLIGHTS_URL = resolve(ASSET_BASE, sqlHighlights);
const SQL_ASSET_LOG = { wasm: SQL_WASM_PATH, highlights: SQL_HIGHLIGHTS_URL };

let registerPromise: Promise<void> | null = null;

async function ensureSqlRegistered(logger?: Logger) {
  if (!registerPromise) {
    registerPromise = (async () => {
      const client = getTreeSitterClient();
      try {
        await client.initialize?.();
      } catch (err) {
        logger?.warn({ err }, "sql-highlight: client initialize failed, continuing");
      }
      logger?.warn({ assets: SQL_ASSET_LOG }, "sql-highlight: register assets");
      client.addFiletypeParser({
        filetype: FILETYPE_SQL,
        wasm: SQL_WASM_PATH,
        queries: { highlights: [SQL_HIGHLIGHTS_URL] },
      });
      try {
        await client.preloadParser?.(FILETYPE_SQL);
      } catch (err) {
        logger?.warn({ err }, "sql-highlight: preload parser failed");
      }
    })().catch((err) => {
      registerPromise = null;
      throw err;
    });
  }
  return registerPromise;
}

function mapGroupToKind(group: string): SqlTokenKind | null {
  switch (group) {
    case "keyword":
    case "keyword.operator":
      return "keyword";
    case "string":
      return "string";
    case "comment":
      return "comment";
    case "number":
    case "float":
    case "boolean":
      return "number";
    case "operator":
      return "operator";
    case "function.call":
    case "variable":
    case "field":
    case "parameter":
    case "attribute":
    case "storageclass":
    case "conditional":
    case "type":
    case "type.qualifier":
    case "type.builtin":
      return "identifier";
    default:
      return null;
  }
}

function buildLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      starts.push(i + 1);
    }
  }
  return starts;
}

function offsetToLineCol(offset: number, lineStarts: number[]): { line: number; col: number } {
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
      return { line: mid, col: offset - start };
    }
  }
  return { line: lineStarts.length - 1, col: 0 };
}

export async function collectSqlHighlightsByLine(
  text: string,
  logger?: Logger,
): Promise<Map<number, SqlHighlightSpan[]>> {
  await ensureSqlRegistered(logger);
  const client = getTreeSitterClient();
  const result = (await client.highlightOnce(text, FILETYPE_SQL)) as HighlightResult;
  const byLine = new Map<number, SqlHighlightSpan[]>();
  if (result.error) {
    logger?.error({ error: result.error }, "sql-highlight: highlightOnce returned issue");
    return byLine
  }
  if (result.warning) {
    logger?.warn({ warning: result.warning }, "sql-highlight: highlightOnce returned issue");
  }

  const highlights = result.highlights ?? [];
  const lineStarts = buildLineStarts(text);

  for (const [startIndex, endIndex, group] of highlights) {
    const kind = mapGroupToKind(String(group));
    if (!kind) {
      continue;
    }
    const start = offsetToLineCol(startIndex, lineStarts);
    const end = offsetToLineCol(endIndex, lineStarts);
    if (start.line !== end.line) {
      continue;
    }
    const spans = byLine.get(start.line) ?? [];
    spans.push({ line: start.line, start: start.col, end: end.col, kind });
    byLine.set(start.line, spans);
  }

  for (const spans of byLine.values()) {
    spans.sort((a, b) => a.start - b.start || a.end - b.end);
  }

  return byLine;
}
