import type { MouseEvent } from "@opentui/core"
import { useTheme } from "@ui/providers/theme"
import { type Accessor, createMemo, createSignal } from "solid-js"
import type { ExplorerRowSegment } from "./explorer-row-renderable.ts"
import type { ExplorerRow as ExplorerRowModel, ExplorerViewModel } from "./view-model/create-vm"
import "./explorer-row-renderable.ts"

const ROW_LEFT_PADDING = 2

type ExplorerRowProps = {
  row: Accessor<ExplorerRowModel>
  isFocused: Accessor<boolean>
  explorer: ExplorerViewModel
}

export function ExplorerRow(props: ExplorerRowProps) {
  const { theme } = useTheme()
  const [hovered, setHovered] = createSignal(false)

  const isSearchMode = () => props.explorer.mode() === "search"
  const row = () => props.row()
  const node = () => row().node()
  const depth = () => row().depth
  const isSelected = () => row().isSelected()

  const fg = () => (isSelected() && props.isFocused() ? theme().get("selection_foreground") : theme().get("text"))
  const bg = () => {
    if (isSelected() && props.isFocused()) return theme().get("selection_background")
    if (hovered()) return theme().get("element_background")
    return theme().get("panel_background")
  }

  const handleMouseDown = (event: MouseEvent) => {
    event.preventDefault()
    const wasFocused = props.isFocused()
    props.explorer.focusSelf()

    if (!isSelected()) {
      row().select()
      return
    }

    if (!wasFocused || isSearchMode()) return

    if (!row().hasChildren) return
    if (row().isExpanded) {
      row().collapse()
      return
    }

    row().expand()
  }

  const rowSegments = createMemo(() => {
    const parts = row().elements
    const isCursorRow = isSelected() && props.isFocused()
    const colors = {
      baseFg: fg(),
      baseBg: bg(),
      glyph: isCursorRow ? fg() : theme().get("text"),
      description: isCursorRow ? fg() : theme().get("text_muted"),
      badge: isCursorRow ? fg() : theme().get("accent"),
    }
    return parts.map(
      (part): ExplorerRowSegment => ({
        text: part.text,
        bg: colors.baseBg,
        fg:
          part.role === "glyph"
            ? colors.glyph
            : part.role === "description"
              ? colors.description
              : part.role === "badge"
                ? colors.badge
                : colors.baseFg,
        attributes: part.attributes,
      }),
    )
  })

  const rowWidth = createMemo(() => row().width)

  return (
    <box
      id={`explorer-row-${node().id}`}
      flexDirection="row"
      paddingLeft={ROW_LEFT_PADDING + depth() * 2}
      paddingRight={1}
      minWidth={30}
      alignSelf="stretch"
      flexShrink={1}
      backgroundColor={bg()}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseDown={handleMouseDown}
    >
      <explorer_row
        segments={rowSegments()}
        width={rowWidth()}
        fg={fg()}
        bg={bg()}
        defaultFg={fg()}
        selectable={false}
      />
    </box>
  )
}
