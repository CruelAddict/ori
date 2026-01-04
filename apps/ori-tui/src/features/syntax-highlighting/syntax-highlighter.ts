import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { addDefaultParsers, getTreeSitterClient, RGBA, SyntaxStyle } from "@opentui/core";
import type { Logger } from "pino";
import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js";
import sqlHighlights from "../../assets/highlights.scm" with { type: "file" };
import sqlWasm from "../../assets/tree-sitter-sql.wasm" with { type: "file" };

export type SyntaxHighlightSpan = {
  start: number;
  end: number;
  styleId: number;
};

export type SyntaxHighlightResult = {
  version: number | string;
  syntaxStyle: SyntaxStyle;
  spans: SyntaxHighlightSpan[];
};

type SyntaxPalette = {
  primary: string;
  accent: string;
  info: string;
  textMuted: string;
  text: string;
  secondary: string;
};

type StyleIds = {
  keyword: number;
  string: number;
  number: number;
  comment: number;
  identifier: number;
  operator: number;
};

type SyntaxStyleBundle = {
  syntaxStyle: SyntaxStyle;
  styleIds: StyleIds;
};

type HighlightRequest = {
  text: string;
  version: number | string;
};

const FILETYPE_SQL = "sql";
const ASSET_BASE = dirname(fileURLToPath(import.meta.url));
const SQL_WASM_PATH = resolve(ASSET_BASE, sqlWasm);
const SQL_HIGHLIGHTS_URL = resolve(ASSET_BASE, sqlHighlights);
const SQL_ASSET_LOG = { wasm: SQL_WASM_PATH, highlights: SQL_HIGHLIGHTS_URL };
const SQL_PARSER = {
  filetype: FILETYPE_SQL,
  wasm: SQL_WASM_PATH,
  queries: { highlights: [SQL_HIGHLIGHTS_URL] },
};

let registerPromise: Promise<void> | null = null;

async function ensureSqlRegistered(logger?: Logger) {
  if (!registerPromise) {
    registerPromise = (async () => {
      addDefaultParsers([SQL_PARSER]);
      const client = getTreeSitterClient();
      try {
        await client.initialize?.();
      } catch (err) {
        logger?.warn({ err }, "syntax-highlighter: client initialize failed, continuing");
      }
      logger?.warn({ assets: SQL_ASSET_LOG }, "syntax-highlighter: register default parser assets");
      try {
        await client.preloadParser?.(FILETYPE_SQL);
      } catch (err) {
        logger?.warn({ err }, "syntax-highlighter: preload parser failed");
      }
    })().catch((err) => {
      registerPromise = null;
      throw err;
    });
  }
  return registerPromise;
}

function buildSyntaxStyle(palette: SyntaxPalette): SyntaxStyleBundle {
  const syntaxStyle = SyntaxStyle.create();
  syntaxStyle.registerStyle("syntax.keyword", { fg: RGBA.fromHex(palette.primary) });
  syntaxStyle.registerStyle("syntax.string", { fg: RGBA.fromHex(palette.accent) });
  syntaxStyle.registerStyle("syntax.number", { fg: RGBA.fromHex(palette.info) });
  syntaxStyle.registerStyle("syntax.comment", { fg: RGBA.fromHex(palette.textMuted) });
  syntaxStyle.registerStyle("syntax.identifier", { fg: RGBA.fromHex(palette.text) });
  syntaxStyle.registerStyle("syntax.operator", { fg: RGBA.fromHex(palette.secondary) });

  return {
    syntaxStyle,
    styleIds: {
      keyword: syntaxStyle.getStyleId("syntax.keyword") ?? 0,
      string: syntaxStyle.getStyleId("syntax.string") ?? 0,
      number: syntaxStyle.getStyleId("syntax.number") ?? 0,
      comment: syntaxStyle.getStyleId("syntax.comment") ?? 0,
      identifier: syntaxStyle.getStyleId("syntax.identifier") ?? 0,
      operator: syntaxStyle.getStyleId("syntax.operator") ?? 0,
    },
  };
}

function mapGroupToStyleId(group: string, styleIds: StyleIds): number | null {
  switch (group) {
    case "keyword":
    case "keyword.operator":
      return styleIds.keyword;
    case "string":
      return styleIds.string;
    case "comment":
      return styleIds.comment;
    case "number":
    case "float":
    case "boolean":
      return styleIds.number;
    case "operator":
      return styleIds.operator;
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
      return styleIds.identifier;
    default:
      return null;
  }
}

async function collectSqlHighlights(text: string, styleIds: StyleIds, logger?: Logger): Promise<SyntaxHighlightSpan[]> {
  await ensureSqlRegistered(logger);
  const client = getTreeSitterClient();
  const result = (await client.highlightOnce(text, FILETYPE_SQL)) as {
    highlights?: [startIndex: number, endIndex: number, group: string][];
    warning?: string;
    error?: string;
  };

  if (result.error) {
    logger?.error({ error: result.error }, "syntax-highlighter: highlightOnce returned issue");
    return [];
  }
  if (result.warning) {
    logger?.warn({ warning: result.warning }, "syntax-highlighter: highlightOnce returned issue");
  }

  const highlights = result.highlights ?? [];
  const spans: SyntaxHighlightSpan[] = [];

  for (const [startIndex, endIndex, group] of highlights) {
    const styleId = mapGroupToStyleId(String(group), styleIds);
    if (styleId == null) {
      continue;
    }
    spans.push({ start: startIndex, end: endIndex, styleId });
  }

  return spans;
}

async function collectHighlightsByLanguage(
  text: string,
  language: string,
  styleIds: StyleIds,
  logger?: Logger,
): Promise<SyntaxHighlightSpan[]> {
  if (language === FILETYPE_SQL) {
    return collectSqlHighlights(text, styleIds, logger);
  }
  logger?.warn({ language }, "syntax-highlighter: unsupported language, returning no highlights");
  return [];
}

export function syntaxHighlighter(params: { theme: Accessor<SyntaxPalette>; language: string; logger?: Logger }) {
  const { theme, language, logger } = params;
  let disposed = false;
  let currentStyle = buildSyntaxStyle(theme());
  let lastRequest: HighlightRequest | null = null;
  let requestToken = 0;

  const [highlightResult, setHighlightResult] = createSignal<SyntaxHighlightResult>({
    version: 0,
    syntaxStyle: currentStyle.syntaxStyle,
    spans: [],
  });

  const runHighlight = async (request: HighlightRequest, style: SyntaxStyleBundle) => {
    const token = ++requestToken;
    try {
      const spans = await collectHighlightsByLanguage(request.text, language, style.styleIds, logger);
      if (disposed || token !== requestToken) {
        return;
      }
      setHighlightResult({
        version: request.version,
        syntaxStyle: style.syntaxStyle,
        spans,
      });
    } catch (err) {
      if (disposed || token !== requestToken) {
        return;
      }
      logger?.error({ err }, "syntax-highlighter: highlight parse failed");
      setHighlightResult({
        version: request.version,
        syntaxStyle: style.syntaxStyle,
        spans: [],
      });
    }
  };

  const scheduleHighlight = (text: string, version: number | string) => {
    const request = { text, version } as HighlightRequest;
    lastRequest = request;
    void runHighlight(request, currentStyle);
  };

  createEffect(() => {
    const palette = theme();
    const nextStyle = buildSyntaxStyle(palette);
    const prevStyle = currentStyle;
    currentStyle = nextStyle;
    prevStyle.syntaxStyle.destroy();

    if (lastRequest) {
      void runHighlight(lastRequest, currentStyle);
    } else {
      setHighlightResult((prev) => ({
        version: prev.version,
        syntaxStyle: currentStyle.syntaxStyle,
        spans: prev.spans,
      }));
    }
  });

  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    currentStyle.syntaxStyle.destroy();
  };

  onCleanup(dispose);

  return {
    scheduleHighlight,
    highlightResult,
    dispose,
  };
}
