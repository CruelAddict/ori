import type { TextareaRenderable } from "@opentui/core"

type EditBufferLargeTextExtension = {
  getText: () => string
  lib?: {
    editBufferGetText: (buffer: unknown, maxLength: number) => Uint8Array | null
    decoder: TextDecoder
  }
  bufferPtr?: unknown
}

type EditorViewLargeTextExtension = {
  getSelectedText: () => string
  lib?: {
    editorViewGetSelectedTextBytes: (view: unknown, maxLength: number) => Uint8Array | null
    decoder: TextDecoder
  }
  viewPtr?: unknown
}

const EDIT_BUFFER_GET_TEXT_MAX_SIZE = 1024 * 1024
const EDIT_BUFFER_GET_TEXT_MAX_SIZE_CAP = 64 * 1024 * 1024
const editBuffers = new WeakSet<EditBufferLargeTextExtension>()
const editorViews = new WeakSet<EditorViewLargeTextExtension>()

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

function readFullEditorSelection(editorView: EditorViewLargeTextExtension, fallback: () => string) {
  if (!editorView.lib || editorView.viewPtr === undefined) {
    return fallback()
  }

  let maxLength = EDIT_BUFFER_GET_TEXT_MAX_SIZE
  let textBytes = editorView.lib.editorViewGetSelectedTextBytes(editorView.viewPtr, maxLength)
  if (!textBytes) {
    return ""
  }

  while (textBytes.length === maxLength) {
    maxLength *= 2
    const next = editorView.lib.editorViewGetSelectedTextBytes(editorView.viewPtr, maxLength)
    if (!next) {
      return ""
    }
    textBytes = next
  }

  return editorView.lib.decoder.decode(textBytes)
}

// OpenTUI editBuffer.getText reads with a fixed internal limit. Consumers that
// build a read model or clipboard payload need complete text, so keep asking the
// native buffers for a larger byte range until they stop returning a full chunk.
export function enableLargeTextRead(node: TextareaRenderable) {
  const editBuffer = node.editBuffer as unknown as EditBufferLargeTextExtension
  if (!editBuffers.has(editBuffer)) {
    const originalGetText = editBuffer.getText.bind(editBuffer)
    editBuffer.getText = (() => readFullEditBufferText(editBuffer, originalGetText)) as typeof editBuffer.getText
    editBuffers.add(editBuffer)
  }

  const editorView = node.editorView as unknown as EditorViewLargeTextExtension
  if (!editorViews.has(editorView)) {
    const originalGetSelectedText = editorView.getSelectedText.bind(editorView)
    editorView.getSelectedText = (() =>
      readFullEditorSelection(editorView, originalGetSelectedText)) as typeof editorView.getSelectedText
    editorViews.add(editorView)
  }
}
