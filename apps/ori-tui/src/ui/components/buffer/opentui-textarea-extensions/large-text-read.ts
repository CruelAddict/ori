import type { TextareaRenderable } from "@opentui/core"

type EditBufferLargeTextExtension = {
  getText: () => string
  lib?: {
    editBufferGetText: (buffer: unknown, maxLength: number) => Uint8Array | null
    decoder: TextDecoder
  }
  bufferPtr?: unknown
}

const EDIT_BUFFER_GET_TEXT_MAX_SIZE = 1024 * 1024
const EDIT_BUFFER_GET_TEXT_MAX_SIZE_CAP = 64 * 1024 * 1024
const editBuffers = new WeakSet<EditBufferLargeTextExtension>()

function readFullEditBufferText(editBuffer: EditBufferLargeTextExtension, fallback: () => string) {
  if (!editBuffer.lib || editBuffer.bufferPtr === undefined) {
    return fallback()
  }

  let maxLength = EDIT_BUFFER_GET_TEXT_MAX_SIZE
  let textBytes = editBuffer.lib.editBufferGetText(editBuffer.bufferPtr, maxLength)
  if (!textBytes) {
    return ""
  }

  while (textBytes.length === maxLength && maxLength < EDIT_BUFFER_GET_TEXT_MAX_SIZE_CAP) {
    maxLength *= 2
    const next = editBuffer.lib.editBufferGetText(editBuffer.bufferPtr, maxLength)
    if (!next) {
      break
    }
    textBytes = next
  }

  return editBuffer.lib.decoder.decode(textBytes)
}

// OpenTUI editBuffer.getText reads with a fixed internal limit. Consumers that
// build a read model from plainText need the complete buffer, so keep asking the
// native buffer for a larger byte range until it stops returning a full chunk.
export function enableLargeTextRead(node: TextareaRenderable) {
  const editBuffer = node.editBuffer as unknown as EditBufferLargeTextExtension
  if (editBuffers.has(editBuffer)) {
    return
  }

  const originalGetText = editBuffer.getText.bind(editBuffer)
  editBuffer.getText = (() => readFullEditBufferText(editBuffer, originalGetText)) as typeof editBuffer.getText
  editBuffers.add(editBuffer)
}
