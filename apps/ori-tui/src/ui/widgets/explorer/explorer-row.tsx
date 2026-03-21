import type { MouseEvent } from "@opentui/core"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "@ui/providers/theme"
import { type Accessor, createMemo, createSignal, Show } from "solid-js"
import type { ExplorerRowSegment } from "./explorer-row-renderable.ts"
import type { ExplorerNode } from "./model/explorer-node"
import type { ExplorerViewModel, VisibleRow } from "./view-model/create-vm"
import "./explorer-row-renderable.ts"

const ROW_LEFT_PADDING = 2
const GLYPH_SEPARATOR_WIDTH = 1

type ExplorerRowProps = {
  row: Accessor<VisibleRow>
  isFocused: Accessor<boolean>
  explorer: ExplorerViewModel
  isRowSelected: (key: string) => boolean
}

export function ExplorerRow(props: ExplorerRowProps) {
  const { theme } = useTheme()
  const [hovered, setHovered] = createSignal(false)

  const isSearchMode = () => props.explorer.mode() === "search"
  const row = () => props.row()
  const rowId = () => row().id
  const depth = () => row().depth
  const node = createMemo(() => props.explorer.getNode(rowId()))
  const isExpanded = () => props.explorer.isExpanded(rowId())
  const isSelected = () => props.isRowSelected(rowId())

  const fg = () => (isSelected() && props.isFocused() ? theme().get("selection_foreground") : theme().get("text"))
  const bg = () => {
    if (isSelected() && props.isFocused()) return theme().get("selection_background")
    if (hovered()) return theme().get("element_background")
    return theme().get("panel_background")
  }

  const handleMouseDown = (event: MouseEvent) => {
    event.preventDefault()
    const wasFocused = props.isFocused()
    const id = rowId()
    props.explorer.focusSelf()

    if (!isSelected()) {
      props.explorer.selectNode(id)
      return
    }

    if (!wasFocused || isSearchMode()) return

    const current = node()
    if (!current?.hasChildren) return
    if (isExpanded()) {
      props.explorer.collapseNode(id)
      return
    }

    props.explorer.expandNode(id)
  }

  const rowParts = createMemo(() => buildRowTextParts(node(), isExpanded(), isSearchMode()))

  const rowSegments = createMemo(() => {
    const parts = rowParts()
    const isCursorRow = isSelected() && props.isFocused()
    const colors = {
      baseFg: fg(),
      baseBg: bg(),
      glyph: isCursorRow ? fg() : theme().get("text"),
      description: isCursorRow ? fg() : theme().get("text_muted"),
      badge: isCursorRow ? fg() : theme().get("accent"),
    }
    const segments: ExplorerRowSegment[] = [
      { text: `${parts.glyph} `, fg: colors.glyph, bg: colors.baseBg, attributes: TextAttributes.DIM },
      { text: parts.main, fg: colors.baseFg, bg: colors.baseBg },
    ]
    if (parts.description) {
      segments.push({
        text: ` ${parts.description}`,
        fg: colors.description,
        bg: colors.baseBg,
        attributes: TextAttributes.DIM,
      })
    }
    if (parts.badges.length > 0) {
      const badges = parts.badges.join(" • ")
      segments.push({
        text: ` ${badges}`,
        fg: colors.badge,
        bg: colors.baseBg,
      })
    }
    return segments
  })

  const rowWidth = createMemo(() => calculateRowTextWidth(rowParts()))

  return (
    <Show
      when={node()}
      keyed
    >
      {(_: ExplorerNode) => (
        <box
          id={`explorer-row-${rowId()}`}
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
      )}
    </Show>
  )
}

type RowTextParts = {
  glyph: string
  main: string
  description?: string
  badges: string[]
}

function buildRowTextParts(details: ExplorerNode | undefined, expanded: boolean, isSearchMode: boolean): RowTextParts {
  const hasChildren = Boolean(details?.hasChildren)
  const glyph = isSearchMode ? "·" : hasChildren ? (expanded ? "▽" : "▷") : "·"
  const label = details?.label ?? ""
  return {
    glyph,
    main: label,
    description: details?.description,
    badges: details?.badges ?? [],
  }
}

function calculateRowTextWidth(parts: RowTextParts): number {
  let width = parts.glyph.length + GLYPH_SEPARATOR_WIDTH + parts.main.length
  if (parts.description) width += 1 + parts.description.length
  if (parts.badges.length > 0) {
    const badges = parts.badges.join(" • ")
    width += 1 + badges.length
  }
  return width
}
