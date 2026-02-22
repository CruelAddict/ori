import type { BoxRenderable, MouseEvent } from "@opentui/core"
import { useTheme } from "@ui/providers/theme"
import { createMemo, createSignal, type JSX, Match, mergeProps, Switch, splitProps } from "solid-js"
import {
  createPositionFromFirstSize,
  DEFAULT_SPLIT_POSITION,
  resolveSplitLayout,
  type SplitOrientation,
  type SplitPosition,
} from "./split-screen-model"

type SplitScreenProps = {
  first: JSX.Element
  second: JSX.Element
  orientation?: SplitOrientation
  firstVisible?: boolean
  secondVisible?: boolean
  initialPosition?: SplitPosition
  minFirstSize?: number
  minSecondSize?: number
  showSeparator?: boolean
  separatorForegroundColor?: string
  separatorBackgroundColor?: string
  separatorHoverForegroundColor?: string
  separatorHoverBackgroundColor?: string
  onPositionChange?: (position: SplitPosition) => void
  [key: string]: unknown
}

type DragState = {
  offset: number
}

export function SplitScreen(props: SplitScreenProps) {
  const propsWithDefaults = mergeProps(
    {
      orientation: "vertical" as SplitOrientation,
      firstVisible: true,
      secondVisible: true,
      initialPosition: DEFAULT_SPLIT_POSITION,
      minFirstSize: 0,
      minSecondSize: 0,
      showSeparator: true,
    },
    props,
  )

  const [local, boxProps] = splitProps(propsWithDefaults, [
    "first",
    "second",
    "orientation",
    "firstVisible",
    "secondVisible",
    "initialPosition",
    "minFirstSize",
    "minSecondSize",
    "showSeparator",
    "separatorForegroundColor",
    "separatorBackgroundColor",
    "separatorHoverForegroundColor",
    "separatorHoverBackgroundColor",
    "onPositionChange",
  ])

  const { theme } = useTheme()
  const [rootNode, setRootNode] = createSignal<BoxRenderable>()
  const [hovered, setHovered] = createSignal(false)
  const [drag, setDrag] = createSignal<DragState | null>(null)
  const [viewport, setViewport] = createSignal({ width: 0, height: 0 })
  const [position, setPosition] = createSignal<SplitPosition>(local.initialPosition)

  const axisSize = createMemo(() => {
    if (local.orientation === "horizontal") {
      return viewport().height
    }
    return viewport().width
  })

  const isMeasured = createMemo(() => axisSize() > 0)

  const separatorPaint = createMemo(() => {
    if (hovered() || drag()) {
      if (local.showSeparator) {
        return {
          fg: local.separatorHoverForegroundColor ?? theme().get("text"),
          bg: local.separatorHoverBackgroundColor ?? theme().get("results_header_background"),
        }
      }

      return {
        fg: local.separatorForegroundColor ?? theme().get("border"),
        bg: local.separatorBackgroundColor,
      }
    }
    return {
      fg: local.separatorForegroundColor ?? theme().get("border"),
      bg: local.separatorBackgroundColor,
    }
  })

  const layout = createMemo(() =>
    resolveSplitLayout({
      axisSize: axisSize(),
      minFirstSize: local.minFirstSize,
      minSecondSize: local.minSecondSize,
      position: position(),
    }),
  )

  const separatorText = createMemo(() => {
    if (!local.showSeparator) {
      if (hovered() || drag()) {
        return local.orientation === "horizontal" ? "↕" : "↔"
      }
      return ""
    }

    const content = local.orientation === "horizontal" ? "─" : "│"
    const repeats = local.orientation === "horizontal" ? viewport().width : viewport().height
    const count = Math.max(1, repeats)

    if (local.orientation === "horizontal") {
      return content.repeat(count)
    }
    return Array.from({ length: count }, () => content).join("\n")
  })

  const syncViewport = () => {
    const node = rootNode()
    if (!node) {
      return
    }

    const next = {
      width: node.width,
      height: node.height,
    }

    setViewport((current) => {
      if (current.width === next.width && current.height === next.height) {
        return current
      }
      return next
    })
  }

  const startDrag = (event: MouseEvent) => {
    if (!(local.firstVisible && local.secondVisible)) {
      return
    }
    const node = rootNode()
    if (!node) {
      return
    }

    const axisStart = local.orientation === "horizontal" ? node.y : node.x
    const pointer = local.orientation === "horizontal" ? event.y : event.x
    const separatorStart = axisStart + layout().firstSize
    setDrag({ offset: pointer - separatorStart })

    event.preventDefault()
    event.stopPropagation()
  }

  const applyDrag = (event: MouseEvent) => {
    const d = drag()
    if (!d) {
      return
    }

    const node = rootNode()
    if (!node) {
      return
    }

    const axisStart = local.orientation === "horizontal" ? node.y : node.x
    const pointer = local.orientation === "horizontal" ? event.y : event.x
    const firstRaw = pointer - axisStart - d.offset
    const dragLayout = resolveSplitLayout({
      axisSize: axisSize(),
      minFirstSize: local.minFirstSize,
      minSecondSize: local.minSecondSize,
      position: {
        mode: "start",
        offset: firstRaw,
      },
    })
    const nextPosition = createPositionFromFirstSize(position(), dragLayout.firstSize, dragLayout.availableSize)

    setPosition(nextPosition)
    local.onPositionChange?.(nextPosition)

    event.preventDefault()
    event.stopPropagation()
  }

  const stopDrag = () => {
    if (!drag()) {
      return
    }
    setDrag(null)
  }

  const renderVerticalSplit = () => (
    <>
      <box
        width={layout().firstSize}
        minWidth={layout().firstSize}
        maxWidth={layout().firstSize}
        height="100%"
        flexGrow={0}
        flexShrink={0}
        minHeight={0}
        visible={isMeasured()}
      >
        {local.first}
      </box>
      <box
        width={1}
        minWidth={1}
        maxWidth={1}
        height="100%"
        flexGrow={0}
        flexShrink={0}
        alignItems="center"
        justifyContent="flex-start"
        backgroundColor={separatorPaint().bg}
        onMouseDown={startDrag}
        onMouseOver={() => setHovered(true)}
        onMouseOut={() => setHovered(false)}
        visible={isMeasured()}
      >
        <text
          fg={separatorPaint().fg}
          selectable={false}
        >
          {separatorText()}
        </text>
      </box>
      <box
        width={layout().secondSize}
        minWidth={layout().secondSize}
        maxWidth={layout().secondSize}
        height="100%"
        flexGrow={0}
        flexShrink={0}
        minHeight={0}
        visible={isMeasured()}
      >
        {local.second}
      </box>
    </>
  )

  const renderHorizontalSplit = () => (
    <>
      <box
        height={layout().firstSize}
        minHeight={layout().firstSize}
        maxHeight={layout().firstSize}
        width="100%"
        flexGrow={0}
        flexShrink={0}
        minWidth={0}
        visible={isMeasured()}
      >
        {local.first}
      </box>
      <box
        height={1}
        minHeight={1}
        maxHeight={1}
        width="100%"
        flexGrow={0}
        flexShrink={0}
        alignItems="center"
        justifyContent="center"
        backgroundColor={separatorPaint().bg}
        onMouseDown={startDrag}
        onMouseOver={() => setHovered(true)}
        onMouseOut={() => setHovered(false)}
        visible={isMeasured()}
      >
        <text
          fg={separatorPaint().fg}
          selectable={false}
        >
          {separatorText()}
        </text>
      </box>
      <box
        height={layout().secondSize}
        minHeight={layout().secondSize}
        maxHeight={layout().secondSize}
        width="100%"
        flexGrow={0}
        flexShrink={0}
        minWidth={0}
        visible={isMeasured()}
      >
        {local.second}
      </box>
    </>
  )

  return (
    <box
      {...boxProps}
      ref={(node: BoxRenderable | undefined) => {
        setRootNode(node)
        syncViewport()
      }}
      flexDirection={local.orientation === "horizontal" ? "column" : "row"}
      onSizeChange={syncViewport}
      onMouseDrag={applyDrag}
      onMouseUp={stopDrag}
      onMouseDragEnd={stopDrag}
      minWidth={0}
      minHeight={0}
    >
      <Switch>
        <Match when={local.firstVisible && !local.secondVisible}>{(_: unknown) => local.first}</Match>
        <Match when={!local.firstVisible && local.secondVisible}>{(_: unknown) => local.second}</Match>
        <Match when={local.orientation === "vertical"}>{(_: unknown) => renderVerticalSplit()}</Match>
        <Match when={local.orientation === "horizontal"}>{(_: unknown) => renderHorizontalSplit()}</Match>
      </Switch>
    </box>
  )
}
