import { TextAttributes, type MouseEvent } from "@opentui/core"
import { useTheme } from "@ui/providers/theme"
import { type Accessor, createMemo, createSignal } from "solid-js"
import type { ExplorerRowSegment } from "./explorer-row-renderable.ts"
import type { ExplorerViewModel } from "./view-model/create-vm"
import type { RowSnapshot } from "./view-model/explorer-rows"
import "./explorer-row-renderable.ts"

const ROW_LEFT_PADDING = 2

type ExplorerRowProps = {
  row: Accessor<RowSnapshot>
  isFocused: Accessor<boolean>
  explorer: ExplorerViewModel
}

export function ExplorerRow(props: ExplorerRowProps) {
  const { theme } = useTheme()
  const [hovered, setHovered] = createSignal(false)

  const isSearchMode = () => props.explorer.mode() === "search"
  const row = () => props.row()
  const depth = () => row().depth
  const isSelected = () => props.explorer.selectedId() === row().id

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
      props.explorer.select(row().id)
      return
    }

    if (!wasFocused || isSearchMode()) return

    if (!row().hasChildren) return
    if (row().isExpanded) {
      props.explorer.collapseRow(row().id)
      return
    }

    props.explorer.expandRow(row().id)
  }

  const treeModeSegments = () => {
    const isCursorRow = isSelected() && props.isFocused()
    const colors = {
      baseFg: fg(),
      baseBg: bg(),
      glyph: isCursorRow ? fg() : theme().get("text"),
      description: isCursorRow ? fg() : theme().get("text_muted"),
      badge: isCursorRow ? fg() : theme().get("accent"),
    }
    const parts: ExplorerRowSegment[] = [
      {
        text: `${getRowGlyph(row(), isSearchMode())} `,
        bg: colors.baseBg,
        fg: colors.glyph,
        attributes: TextAttributes.DIM,
      },
      {
        text: row().name,
        bg: colors.baseBg,
        fg: colors.baseFg,
      },
    ]

    if (row().description) {
      parts.push({
        text: ` ${row().description}`,
        bg: colors.baseBg,
        fg: colors.description,
      })
    }

    if (row().badges.length > 0) {
      parts.push({
        text: ` ${row().badges.join(" • ")}`,
        bg: colors.baseBg,
        fg: colors.badge,
      })
    }

    return parts
  }

  const searchModeSegments = () => {
    const isCursorRow = isSelected() && props.isFocused()
    const colors = {
      baseFg: fg(),
      baseBg: bg(),
      glyph: isCursorRow ? fg() : theme().get("text"),
      description: isCursorRow ? fg() : theme().get("text_muted"),
      badge: isCursorRow ? fg() : theme().get("accent"),
    }
    const parts: ExplorerRowSegment[] = [
      {
        text: `${getRowGlyph(row(), isSearchMode())} `,
        bg: colors.baseBg,
        fg: colors.glyph,
        attributes: TextAttributes.DIM,
      },
    ]

    if (row().type) {
      parts.push({
        text: `${row().type} `,
        bg: colors.baseBg,
        fg: colors.badge,
      })
    }

    parts.push({
      text: row().name,
      bg: colors.baseBg,
      fg: colors.baseFg,
    })

    return parts
  }

  const rowSegments = createMemo(() => isSearchMode() ? searchModeSegments() : treeModeSegments())

  const rowWidth = createMemo(() => rowSegments().reduce((sum, part) => sum + part.text.length, 0))

  return (
    <box
      id={`explorer-row-${row().id}`}
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


function getRowGlyph(row: RowSnapshot, isSearchMode: boolean) {
  if (isSearchMode) return "·"
  if (!row.hasChildren) return "·"
  if (row.isExpanded) return "▽"
  return "▷"
}
