import { useTheme } from "@app/providers/theme"
import type { BoxRenderable, MouseEvent } from "@opentui/core"
import { TextAttributes } from "@opentui/core"
import type { NodeEntity } from "@src/entities/schema-tree/model/node-entity"
import type { TreePaneViewModel } from "@src/features/tree-pane/use-tree-pane"
import { type Accessor, createEffect, createMemo, createSignal, For, Show } from "solid-js"
import type { TreeRowSegment } from "./tree-row-renderable.ts"
import "./tree-row-renderable.ts"
import { type RowDescriptor, useTreeScrollRegistration } from "./tree-scrollbox.tsx"

const ROW_LEFT_PADDING = 2
const GLYPH_SEPARATOR_WIDTH = 1

type TreeNodeProps = {
  nodeId: string
  depth: number
  isFocused: Accessor<boolean>
  pane: TreePaneViewModel
  isRowSelected: (key: string) => boolean
}

export function TreeNode(props: TreeNodeProps) {
  const registerRowNode = useTreeScrollRegistration()
  const { theme } = useTheme()
  const palette = theme

  const entity = createMemo(() => props.pane.controller.getEntity(props.nodeId))
  const childIds = createMemo(() => props.pane.controller.getRenderableChildIds(props.nodeId))
  const rowId = () => props.nodeId
  const isExpanded = () => props.pane.controller.isExpanded(props.nodeId)
  const isSelected = () => props.isRowSelected(props.nodeId)
  const [childrenMounted, setChildrenMounted] = createSignal(false)
  const [hovered, setHovered] = createSignal(false)

  createEffect(() => {
    if (isExpanded()) setChildrenMounted(true)
  })

  const fg = () => (isSelected() && props.isFocused() ? palette().background : palette().text)
  const bg = () => {
    if (isSelected() && props.isFocused()) return palette().primary
    if (hovered()) return palette().backgroundElement
    return palette().backgroundPanel
  }

  const handleMouseDown = (event: MouseEvent) => {
    event.preventDefault()
    props.pane.focusSelf()

    if (!isSelected()) {
      props.pane.controller.selectNode(props.nodeId)
      return
    }

    const details = entity()
    if (!details?.hasChildren) return
    if (isExpanded()) {
      props.pane.controller.collapseNode(props.nodeId)
    } else {
      props.pane.controller.expandNode(props.nodeId)
    }
  }

  const rowParts = createMemo(() => buildRowTextParts(entity(), isExpanded()))

  const rowSegments = createMemo(() => {
    const parts = rowParts()
    const colors = {
      baseFg: fg(),
      baseBg: bg(),
      accent: palette().accent,
    }
    const segments: TreeRowSegment[] = [
      { text: `${parts.glyph} `, fg: colors.baseFg, bg: colors.baseBg, attributes: TextAttributes.DIM },
      { text: parts.main, fg: colors.baseFg, bg: colors.baseBg },
    ]
    if (parts.description) {
      segments.push({
        text: ` ${parts.description}`,
        fg: colors.baseFg,
        bg: colors.baseBg,
        attributes: TextAttributes.DIM,
      })
    }
    if (parts.badges) {
      segments.push({
        text: ` ${parts.badges}`,
        fg: colors.accent,
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
      {(_: NodeEntity) => (
        <>
          <box
            id={`tree-row-${rowId()}`}
            flexDirection="row"
            paddingLeft={ROW_LEFT_PADDING + props.depth * 2}
            minWidth="100%"
            flexShrink={0}
            ref={(node: BoxRenderable | undefined) => registerRowNode(rowId(), node)}
            backgroundColor={bg()}
            onMouseOver={() => setHovered(true)}
            onMouseOut={() => setHovered(false)}
            onMouseDown={handleMouseDown}
          >
            <tree_row
              segments={rowSegments()}
              width={rowWidth()}
              fg={fg()}
              bg={bg()}
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
                  <TreeNode
                    nodeId={childId}
                    depth={props.depth + 1}
                    isFocused={props.isFocused}
                    pane={props.pane}
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
  badges?: string
}

function buildRowTextParts(details: NodeEntity | undefined, expanded: boolean): RowTextParts {
  // TODO: handle undefined?
  const hasChildren = Boolean(details?.hasChildren)
  const glyph = hasChildren ? (expanded ? "▽" : "▷") : "·"
  const label = details?.label ?? ""
  return {
    glyph,
    main: label,
    description: details?.description,
    badges: details?.badges,
  }
}

function calculateRowTextWidth(parts: RowTextParts): number {
  let width = parts.glyph.length + GLYPH_SEPARATOR_WIDTH + parts.main.length
  if (parts.description) width += 1 + parts.description.length
  if (parts.badges) width += 1 + parts.badges.length
  return width
}

function calculateRowWidth(parts: RowTextParts, depth: number): number {
  return ROW_LEFT_PADDING + depth * 2 + calculateRowTextWidth(parts)
}

export function createRowWidthAccessor(options: {
  getEntity: (id: string) => NodeEntity | undefined
  isExpanded: (id: string) => boolean
}) {
  const { getEntity, isExpanded } = options
  const cache = new Map<string, number>()

  return (row: RowDescriptor): number => {
    const expanded = isExpanded(row.id)
    const key = `${row.id}@${row.depth}:${expanded ? 1 : 0}`

    const cached = cache.get(key)
    if (cached !== undefined) return cached

    const entity = getEntity(row.id)
    const parts = buildRowTextParts(entity, expanded)
    const width = calculateRowWidth(parts, row.depth)

    cache.set(key, width)
    return width
  }
}
