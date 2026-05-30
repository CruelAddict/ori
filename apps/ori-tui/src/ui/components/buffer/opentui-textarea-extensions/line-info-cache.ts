import type { LineInfo, TextareaRenderable } from "@opentui/core"

type TextareaLineInfoCacheExtension = TextareaRenderable & {
  editorView: {
    getLogicalLineInfo: () => LineInfo
  }
}

export type LineInfoCache = {
  getLineInfo: (ref: TextareaRenderable) => LineInfo
  clearLineInfoCache: (ref?: TextareaRenderable) => void
  readOrSet: (ref: TextareaRenderable, read: () => LineInfo) => LineInfo
}

const textareas = new WeakSet<TextareaRenderable>()

// LineInfo is expensive and is often read repeatedly while deriving layout,
// viewport, and render metadata. Keep one snapshot per live textarea and
// invalidate it explicitly when layout-affecting operations happen.
export function createLineInfoCache(getDefaultRef: () => TextareaRenderable | undefined): LineInfoCache {
  let cachedLineInfoRef: TextareaRenderable | undefined
  let cachedLineInfo: LineInfo | undefined

  const clearLineInfoCache = (node = getDefaultRef()) => {
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

  return {
    getLineInfo: (ref) => readOrSet(ref, () => ref.lineInfo),
    clearLineInfoCache,
    readOrSet,
  }
}

// OpenTUI's editorView.getLogicalLineInfo bypasses TextareaRenderable.lineInfo.
// Route both APIs through the same cache so layout readers share one snapshot
// instead of recomputing native line info through different paths.
export function addLogicalLineInfoCache(node: TextareaRenderable, cache: LineInfoCache) {
  if (textareas.has(node)) {
    return
  }

  const textarea = node as TextareaLineInfoCacheExtension
  const originalGetLogicalLineInfo = textarea.editorView.getLogicalLineInfo.bind(textarea.editorView)
  textarea.editorView.getLogicalLineInfo = (() =>
    cache.readOrSet(
      textarea,
      originalGetLogicalLineInfo,
    )) as TextareaLineInfoCacheExtension["editorView"]["getLogicalLineInfo"]

  textareas.add(node)
}
