import type { Renderable } from "@opentui/core"
import { type Accessor, type Component, createSignal } from "solid-js"

export type OverlayComponentProps = {
  close: () => void
}

export type OverlayEntry = {
  id: string
  render: Component<OverlayComponentProps>
  zIndex: number
}

export type OverlayOptions = {
  id?: string
  render: Component<OverlayComponentProps>
  zIndex?: number
}

type Renderer = {
  root: Renderable
  currentFocusedRenderable?: Renderable | null
}

export type OverlayManager = {
  overlays: Accessor<OverlayEntry[]>
  setRenderer(renderer: Renderer): void
  show(options: OverlayOptions): string
  dismiss(id: string): void
}

export function createOverlayManager(): OverlayManager {
  const [overlays, setOverlays] = createSignal<OverlayEntry[]>([])
  let overlayIdCounter = 0
  let nextLayer = 1
  let renderer: Renderer | undefined
  let previousFocus: Renderable | null = null

  const refocus = () => {
    if (!previousFocus) {
      return
    }
    if (previousFocus.isDestroyed) {
      return
    }

    setTimeout(() => {
      if (!renderer) {
        return
      }
      if (!previousFocus) {
        return
      }
      if (previousFocus.isDestroyed) {
        return
      }

      function find(item: Renderable): boolean {
        for (const child of item.getChildren()) {
          if (child === previousFocus) return true
          if (find(child)) return true
        }
        return false
      }

      const found = find(renderer.root)
      if (!found) return
      previousFocus.focus()
    }, 1)
  }

  const show = (options: OverlayOptions) => {
    const id = options.id ?? `overlay-${++overlayIdCounter}`

    if (id && overlays().some((entry) => entry.id === id)) {
      return id
    }

    if (renderer && overlays().length === 0) {
      previousFocus = renderer.currentFocusedRenderable ?? null
    }

    const zIndex = options.zIndex ?? nextLayer++
    setOverlays((prev) => [...prev, { id, render: options.render, zIndex }])
    return id
  }

  const dismiss = (id: string) => {
    setOverlays((prev) => prev.filter((entry) => entry.id !== id))

    if (overlays().length === 0) {
      refocus()
    }
  }

  return {
    overlays,
    setRenderer: (r) => {
      renderer = r
    },
    show,
    dismiss,
  }
}
