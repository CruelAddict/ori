import { useRenderer } from "@opentui/solid"
import { createOverlayManager, type OverlayManager } from "@ui/widgets/overlay/overlay-store"
import { createContext, type JSX, onMount, useContext } from "solid-js"

const OverlayContext = createContext<OverlayManager>()

export function OverlayProvider(props: { children: JSX.Element }) {
  const manager = createOverlayManager()
  const renderer = useRenderer()

  onMount(() => {
    manager.setRenderer(renderer)
  })

  return <OverlayContext.Provider value={manager}>{props.children}</OverlayContext.Provider>
}

export function useOverlayManager(): OverlayManager {
  const ctx = useContext(OverlayContext)
  if (!ctx) {
    throw new Error("OverlayProvider is missing in component tree")
  }
  return ctx
}
