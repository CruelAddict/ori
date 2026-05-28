import { describe, expect, test } from "bun:test"
import { docCharOffset, documentVersion, lineCharPosition } from "./coords"
import { Document } from "./document"

describe("buffer document", () => {
  test("normalizes CRLF and carriage returns to LF", () => {
    const document = Document.create("select 1\r\nselect 2\rselect 3")

    expect(document.text).toBe("select 1\nselect 2\nselect 3")
    expect(document.lineStarts).toEqual([docCharOffset(0), docCharOffset(9), docCharOffset(18)])
    expect(document.version).toBe(documentVersion(0))
    expect(document.modified).toBe(false)
  })

  test("keeps text, line starts, version, and modified state aligned after edits", () => {
    const initial = Document.create("one\ntwo")
    const edit = initial.applyText("one\ntwo\nthree", true)

    expect(edit.document.text).toBe("one\ntwo\nthree")
    expect(edit.document.lineStarts).toEqual([docCharOffset(0), docCharOffset(4), docCharOffset(8)])
    expect(edit.document.version).toBe(documentVersion(1))
    expect(edit.document.modified).toBe(true)
    expect(edit.change).toEqual({ start: docCharOffset(7), previousEnd: docCharOffset(7), nextEnd: docCharOffset(13) })
  })

  test("maps logical line columns to document offsets", () => {
    const document = Document.create("auth\nUSE\n")

    expect(document.offsetAtLineChar(0, 2)).toBe(docCharOffset(2))
    expect(document.offsetAtLineChar(1, 2)).toBe(docCharOffset(7))
    expect(document.offsetAtLineChar(0, 99)).toBe(docCharOffset(4))
    expect(document.offsetAtLineChar(99, 2)).toBe(docCharOffset(9))
  })

  test("maps document offsets to logical line positions", () => {
    const document = Document.create("auth\nUSE\n")

    expect(document.positionAtOffset(docCharOffset(0))).toEqual(lineCharPosition(0, 0))
    expect(document.positionAtOffset(docCharOffset(6))).toEqual(lineCharPosition(1, 1))
    expect(document.positionAtOffset(docCharOffset(999))).toEqual(lineCharPosition(2, 0))
  })
})
