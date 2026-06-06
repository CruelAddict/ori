import type { SyntaxStyle } from "@opentui/core"
import type { BufferTextChange, Document } from "./document"
import type { RenderTarget } from "./render-target"
import type { ViewportSnapshot } from "./viewport-snapshot"

export type BufferDocumentChangeReason = "initial" | "edit" | "replace"

export type BufferDocumentChangeEvent = {
  document: Document
  change?: BufferTextChange
  reason: BufferDocumentChangeReason
}

export type BufferDecorationsRenderEvent = {
  allowAsyncWork: boolean
}

type Listener<T> = (event: T) => void
type Unsubscribe = () => void

export type BufferExtensionHost = {
  getDocument: () => Document
  getViewport: () => ViewportSnapshot | undefined
  getRenderTarget: () => RenderTarget | undefined
  setSyntaxStyle: (style: SyntaxStyle | null) => void
  requestDecorationsRender: () => void
  onDocumentChange: (listener: Listener<BufferDocumentChangeEvent>) => Unsubscribe
  onDecorationsRender: (listener: Listener<BufferDecorationsRenderEvent>) => Unsubscribe
}

export type BufferExtension = {
  id: string
  setup: (host: BufferExtensionHost) => Unsubscribe | undefined
}

type BufferExtensionHostInput = Omit<BufferExtensionHost, "onDocumentChange" | "onDecorationsRender">

export function attachBufferExtensions(extensions: readonly BufferExtension[], host: BufferExtensionHostInput) {
  const documentChangeListeners = new Set<Listener<BufferDocumentChangeEvent>>()
  const decorationsRenderListeners = new Set<Listener<BufferDecorationsRenderEvent>>()

  const subscribe = <T>(listeners: Set<Listener<T>>, listener: Listener<T>) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  const extensionHost: BufferExtensionHost = {
    ...host,
    onDocumentChange: (listener) => subscribe(documentChangeListeners, listener),
    onDecorationsRender: (listener) => subscribe(decorationsRenderListeners, listener),
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
    emitDecorationsRender: (event: BufferDecorationsRenderEvent) => {
      emit(decorationsRenderListeners, event)
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
