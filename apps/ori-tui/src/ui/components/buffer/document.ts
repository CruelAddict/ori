import { buildLineStarts, offsetToLineCol } from "@utils/line-offsets"
import {
  type DocCharOffset,
  type DocumentVersion,
  docCharOffset,
  documentVersion,
  type LineCharPosition,
  type LineIndex,
  lineCharPosition,
} from "./coords"

export type BufferTextChange = {
  start: DocCharOffset
  previousEnd: DocCharOffset
  nextEnd: DocCharOffset
}

export function normalizeDocumentText(text: string) {
  return text.replace(/\r\n?/g, "\n")
}

export function findTextChange(previous: string, next: string): BufferTextChange | undefined {
  if (previous === next) {
    return undefined
  }

  const limit = Math.min(previous.length, next.length)
  let prefix = 0
  for (; prefix < limit; prefix += 1) {
    if (previous[prefix] !== next[prefix]) {
      break
    }
  }

  const suffixLimit = Math.min(previous.length - prefix, next.length - prefix)
  let suffix = 0
  for (; suffix < suffixLimit; suffix += 1) {
    if (previous[previous.length - 1 - suffix] !== next[next.length - 1 - suffix]) {
      break
    }
  }

  return {
    start: docCharOffset(prefix),
    previousEnd: docCharOffset(previous.length - suffix),
    nextEnd: docCharOffset(next.length - suffix),
  }
}

function buildDocumentLineStarts(text: string): readonly DocCharOffset[] {
  return buildLineStarts(text).map(docCharOffset)
}

export type DocumentEdit = {
  document: Document
  change?: BufferTextChange
}

export class Document {
  readonly text: string
  readonly lineStarts: readonly DocCharOffset[]
  readonly version: DocumentVersion
  readonly modified: boolean

  private constructor(text: string, lineStarts: readonly DocCharOffset[], version: DocumentVersion, modified: boolean) {
    this.text = text
    this.lineStarts = lineStarts
    this.version = version
    this.modified = modified
  }

  static create(text: string) {
    const normalized = normalizeDocumentText(text)
    return new Document(normalized, buildDocumentLineStarts(normalized), documentVersion(0), false)
  }

  lineStart(line: LineIndex): DocCharOffset {
    return this.lineStarts[line] ?? docCharOffset(0)
  }

  nextLineStart(line: LineIndex): DocCharOffset {
    return this.lineStarts[line + 1] ?? docCharOffset(this.text.length)
  }

  lineEnd(line: LineIndex): DocCharOffset {
    const start = this.lineStart(line)
    const next = this.nextLineStart(line)
    return docCharOffset(next > start && this.text[next - 1] === "\n" ? next - 1 : next)
  }

  lineText(line: LineIndex): string {
    return this.text.slice(this.lineStart(line), this.lineEnd(line))
  }

  lineColAt(offset: DocCharOffset): LineCharPosition {
    const cursor = offsetToLineCol(offset, this.lineStarts)
    return lineCharPosition(cursor.line, cursor.col)
  }

  applyText(nextText: string, modified: boolean): DocumentEdit {
    const normalized = normalizeDocumentText(nextText)
    const change = findTextChange(this.text, normalized)
    if (!change && modified === this.modified) {
      return { document: this }
    }

    return {
      document: new Document(
        normalized,
        buildDocumentLineStarts(normalized),
        documentVersion(this.version + 1),
        modified,
      ),
      change,
    }
  }

  resetText(nextText: string): DocumentEdit {
    return this.applyText(nextText, false)
  }
}
