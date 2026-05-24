import { describe, expect, test } from "bun:test"
import { docCharOffset, documentVersion } from "./coords"
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
})
