import { useSelectionController } from "@ui/selection/selection-controller"
import type { JSX } from "solid-js"

export function SelectionControllerTestRoot(props: { children: JSX.Element }) {
  const selection = useSelectionController({ onSelected: () => {} })

  return (
    /* biome-ignore lint/a11y/noStaticElementInteractions: test root mirrors app-level OpenTUI selection handlers */
    <box
      flexDirection="row"
      onMouseMove={selection.rootHandlers.onMouseMove}
      onMouseUp={selection.rootHandlers.onMouseUp}
    >
      {props.children}
    </box>
  )
}
