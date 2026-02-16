import { useTheme } from "@app/providers/theme"
import type { BoxRenderable, MouseEvent } from "@opentui/core"
import { TextAttributes } from "@opentui/core"
import { type Accessor, createEffect, createMemo, createSignal, For, Show } from "solid-js"
import type { ExplorerRowSegment } from "./explorer-row-renderable.ts"
import type { ExplorerViewModel } from "./model/create-explorer-model"
import type { ExplorerNode } from "./model/explorer-node"
import "./explorer-row-renderable.ts"
import { useExplorerScrollRegistration } from "./explorer-scrollbox.tsx"

const ROW_LEFT_PADDING = 2
const GLYPH_SEPARATOR_WIDTH = 1

type ExplorerRowProps = {
  nodeId: string
  depth: number
  isFocused: Accessor<boolean>
  explorer: ExplorerViewModel
  isRowSelected: (key: string) => boolean
}

export function ExplorerRow(props: ExplorerRowProps) {
  const registerRowNode = useExplorerScrollRegistration()
  const { theme } = useTheme()

  const entity = createMemo(() => props.explorer.controller.getEntity(props.nodeId))
  const childIds = createMemo(() => props.explorer.controller.getRenderableChildIds(props.nodeId))
  const rowId = () => props.nodeId
  const isExpanded = () => props.explorer.controller.isExpanded(props.nodeId)
  const isSelected = () => props.isRowSelected(props.nodeId)
  const [childrenMounted, setChildrenMounted] = createSignal(false)
  const [hovered, setHovered] = createSignal(false)

  createEffect(() => {
    if (isExpanded()) setChildrenMounted(true)
  })

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
      props.explorer.controller.selectNode(props.nodeId)
      return
    }

    if (!wasFocused) return

    const details = entity()
    if (!details?.hasChildren) return
    if (isExpanded()) {
      props.explorer.controller.collapseNode(props.nodeId)
    } else {
      props.explorer.controller.expandNode(props.nodeId)
    }
  }

  const rowParts = createMemo(() => buildRowTextParts(entity(), isExpanded()))

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
      when={entity()}
      keyed
    >
      {(_: ExplorerNode) => (
        <>
          <box
            id={`explorer-row-${rowId()}`}
            flexDirection="row"
            paddingLeft={ROW_LEFT_PADDING + props.depth * 2}
            paddingRight={1}
            minWidth={30}
            alignSelf="stretch"
            flexShrink={1}
            ref={(node: BoxRenderable | undefined) => registerRowNode(rowId(), node)}
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
          <Show when={childrenMounted()}>
            <box
              flexDirection="column"
              visible={isExpanded()}
            >
              <For each={childIds()}>
                {(childId) => (
                  <ExplorerRow
                    nodeId={childId}
                    depth={props.depth + 1}
                    isFocused={props.isFocused}
                    explorer={props.explorer}
                    isRowSelected={props.isRowSelected}
                  />
                )}
              </For>
            </box>
          </Show>
        </>
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

function buildRowTextParts(details: ExplorerNode | undefined, expanded: boolean): RowTextParts {
  const hasChildren = Boolean(details?.hasChildren)
  const glyph = hasChildren ? (expanded ? "▽" : "▷") : "·"
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
