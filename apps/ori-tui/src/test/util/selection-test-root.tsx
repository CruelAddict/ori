import { useSelection } from "@ui/providers/selection"
import type { JSX } from "solid-js"

export function SelectionTestRoot(props: { children: JSX.Element }) {
  const selection = useSelection()

  return (
    /* biome-ignore lint/a11y/noStaticElementInteractions: test root mirrors app-level OpenTUI selection handlers */
    <box
      flexDirection="row"
      onMouseUp={selection.handleMouseUp}
    >
      {props.children}
    </box>
  )
}
