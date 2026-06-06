import type { SyntaxStyle } from "@opentui/core"
import type { DocCharOffset, LineIndex } from "./coords"
import type { BufferTextChange, Document } from "./document"
import type { RenderTarget } from "./render-target"
import type { ViewportSnapshot } from "./viewport-snapshot"

export type BufferDocumentChangeReason = "initial" | "edit" | "replace"

export type BufferDocumentChangeEvent = {
  document: Document
  change?: BufferTextChange
  reason: BufferDocumentChangeReason
}

export type BufferExtensionCursor =
  | {
      line: LineIndex
      offset: DocCharOffset
    }
  | undefined

type Listener<T> = (event: T) => void
type Unsubscribe = () => void

export type BufferExtensionHost = {
  getDocument: () => Document
  getCursor: () => BufferExtensionCursor
  getViewport: () => ViewportSnapshot | undefined
  getRenderTarget: () => RenderTarget | undefined
  setGutterMarkers: (markers: ReadonlyMap<number, string>) => void
  setSyntaxStyle: (style: SyntaxStyle | null) => void
  requestDecorationsRender: () => void
  onDocumentChange: (listener: Listener<BufferDocumentChangeEvent>) => Unsubscribe
  onDecorationsRender: (listener: () => void) => Unsubscribe
}

export type BufferExtension = {
  id: string
  setup: (host: BufferExtensionHost) => Unsubscribe | undefined
}

type BufferExtensionHostInput = Omit<BufferExtensionHost, "onDocumentChange" | "onDecorationsRender">

export function attachBufferExtensions(extensions: readonly BufferExtension[], host: BufferExtensionHostInput) {
  const documentChangeListeners = new Set<Listener<BufferDocumentChangeEvent>>()
  const decorationsRenderListeners = new Set<() => void>()

  const subscribe = <T>(listeners: Set<Listener<T>>, listener: Listener<T>) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  const subscribeRender = (listener: () => void) => {
    decorationsRenderListeners.add(listener)
    return () => {
      decorationsRenderListeners.delete(listener)
    }
  }

  const extensionHost: BufferExtensionHost = {
    ...host,
    onDocumentChange: (listener) => subscribe(documentChangeListeners, listener),
    onDecorationsRender: subscribeRender,
  }

  const disposers = extensions.map((extension) => extension.setup(extensionHost)).filter((dispose) => !!dispose)

  const emit = <T>(listeners: Set<Listener<T>>, event: T) => {
    for (const listener of listeners) {
      listener(event)
    }
  }

  return {
    emitDocumentChange: (event: BufferDocumentChangeEvent) => {
      emit(documentChangeListeners, event)
    },
    emitDecorationsRender: () => {
      for (const listener of decorationsRenderListeners) {
        listener()
      }
    },
    dispose: () => {
      for (const dispose of disposers) {
        dispose()
      }
      documentChangeListeners.clear()
      decorationsRenderListeners.clear()
    },
  }
}
