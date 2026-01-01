import type { SyntaxStyle, TextareaRenderable } from "@opentui/core";

const SYNTAX_EXTMARK_TYPE = "syntax-highlight";

type LineSpan = { start: number; end: number; styleId: number };

function getSyntaxHighlightTypeID(ref: TextareaRenderable) {
  return ref.extmarks.getTypeId(SYNTAX_EXTMARK_TYPE) ?? ref.extmarks.registerType(SYNTAX_EXTMARK_TYPE);
}

function clearSyntaxExtmarks(ref: TextareaRenderable, typeId: number) {
  const marks = ref.extmarks.getAllForTypeId(typeId);
  for (const mark of marks) {
    ref.extmarks.delete(mark.id);
  }
}

function spansEqual(a: LineSpan[], b: LineSpan[]) {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    const left = a[i];
    const right = b[i];
    if (left.start !== right.start || left.end !== right.end || left.styleId !== right.styleId) {
      return false;
    }
  }
  return true;
}

export function applySyntaxHighlights(params: {
  spansByLine: Map<number, LineSpan[]>;
  syntaxStyle: SyntaxStyle;
  lineCount: number;
  getLineRef: (index: number) => TextareaRenderable | undefined;
}) {
  const { spansByLine, syntaxStyle, lineCount, getLineRef } = params;

  for (let index = 0; index < lineCount; index++) {
    const ref = getLineRef(index);
    if (!ref) {
      continue;
    }

    const refState = ref as TextareaRenderable & { syntaxStyle?: SyntaxStyle; __syntaxSpans?: LineSpan[] };
    const prevSpans = refState.__syntaxSpans ?? [];
    const nextSpans = spansByLine.get(index) ?? [];
    const styleChanged = refState.syntaxStyle !== syntaxStyle;
    const spansChanged = !spansEqual(prevSpans, nextSpans);

    if (!styleChanged && !spansChanged) {
      continue;
    }

    if (spansChanged) {
      const typeId = getSyntaxHighlightTypeID(ref);
      clearSyntaxExtmarks(ref, typeId);
      for (const span of nextSpans) {
        ref.extmarks.create({
          start: span.start,
          end: span.end,
          styleId: span.styleId,
          typeId,
          virtual: false,
        });
      }
      refState.__syntaxSpans = nextSpans.map((span) => ({ ...span }));
    }

    if (styleChanged) {
      refState.syntaxStyle = syntaxStyle;
    }

    ref.requestRender();
  }
}
