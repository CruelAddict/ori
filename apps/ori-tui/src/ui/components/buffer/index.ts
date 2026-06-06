export type {
  BufferAutocompleteItem,
  BufferAutocompleteProvider,
  BufferAutocompleteRequest,
  BufferAutocompleteResult,
  BufferAutocompleteState,
} from "./autocomplete/types"
export { Buffer, type BufferApi, type BufferCursor, type BufferProps, type BufferState } from "./buffer"
export type {
  DisplayColumn,
  DocCharOffset,
  DocCharRange,
  DocumentVersion,
  LineCharOffset,
  LineCharPosition,
  LineCharRange,
  LineDisplayRange,
  LineIndex,
  TotalVisualRows,
  ViewportHeight,
  ViewportTop,
} from "./coords"
export { Document } from "./document"
export type { BufferExtension, BufferExtensionHost } from "./extension"
export { type BufferStatementDetector, createStatementsExtension } from "./extensions/statements"
export { createSyntaxHighlightsExtension } from "./extensions/syntax-highlights"
export type { RenderTarget } from "./render-target"
export type { TextDisplayPoint, TextGeometry, TextLineGeometry, TextLinePosition } from "./text-geometry"
export type { ViewportCursorState } from "./viewport"
export type { ViewportPoint } from "./viewport-geometry"
export type { ViewportSnapshot } from "./viewport-snapshot"
