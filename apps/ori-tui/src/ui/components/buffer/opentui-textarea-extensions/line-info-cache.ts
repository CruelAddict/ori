import type { LineInfo, TextareaRenderable } from "@opentui/core"

type TextareaLineInfoCacheExtension = TextareaRenderable & {
  editorView: {
    getLogicalLineInfo: () => LineInfo
  }
}

type TextareaLineInfoCache = {
  attach: (node: TextareaRenderable) => void
  read: (ref: TextareaRenderable) => LineInfo
  clear: (ref?: TextareaRenderable) => void
}

const textareas = new WeakSet<TextareaRenderable>()

// LineInfo is expensive and is often read repeatedly while deriving layout,
// viewport, and render metadata. Keep one snapshot per live textarea and
// invalidate it explicitly when layout-affecting operations happen.
export function createTextareaLineInfoCache(
  getDefaultRef: () => TextareaRenderable | undefined,
): TextareaLineInfoCache {
  let cachedLineInfoRef: TextareaRenderable | undefined
  let cachedLineInfo: LineInfo | undefined

  const clear = (node = getDefaultRef()) => {
    if (!node) {
      cachedLineInfoRef = undefined
      cachedLineInfo = undefined
      return
    }

    if (cachedLineInfoRef === node) {
      cachedLineInfoRef = undefined
      cachedLineInfo = undefined
    }
  }

  const readOrSet = (ref: TextareaRenderable, read: () => LineInfo) => {
    if (cachedLineInfoRef === ref && cachedLineInfo) {
      return cachedLineInfo
    }

    const info = read()
    cachedLineInfoRef = ref
    cachedLineInfo = info
    return info
  }

  const attach = (node: TextareaRenderable) => {
    if (textareas.has(node)) {
      return
    }

    const textarea = node as TextareaLineInfoCacheExtension
    const originalGetLogicalLineInfo = textarea.editorView.getLogicalLineInfo.bind(textarea.editorView)
    textarea.editorView.getLogicalLineInfo = (() =>
      readOrSet(
        textarea,
        originalGetLogicalLineInfo,
      )) as TextareaLineInfoCacheExtension["editorView"]["getLogicalLineInfo"]

    textareas.add(node)
  }

  return {
    attach,
    read: (ref) => readOrSet(ref, () => ref.lineInfo),
    clear,
  }
}
