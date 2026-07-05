import { useAppContext } from "@ui/providers/app-context"
import { useTheme } from "@ui/providers/theme"
import type { HighlightGroup } from "@ui/theme"
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { defaultStatuslineLayout } from "./statusline-config"
import type {
  StatuslineContext,
  StatuslineGroup,
  StatuslineNode,
  StatuslinePlugin,
  StatuslineSlot,
} from "./statusline-types"

const CLOCK_TICK_MS = 250

function renderNode(node: StatuslineNode, ctx: StatuslineContext) {
  if (Array.isArray(node)) {
    return (
      <StatuslineSlotView
        plugins={node}
        ctx={ctx}
      />
    )
  }
  if ("render" in node) {
    return (
      <StatuslinePluginView
        plugin={node}
        ctx={ctx}
      />
    )
  }
  return (
    <StatuslineGroupView
      node={node}
      ctx={ctx}
    />
  )
}

function nodesWithGap(nodes: StatuslineNode[], gap: number, ctx: StatuslineContext) {
  const size = Math.max(0, Math.floor(gap))
  const delimiter = " ".repeat(size)
  const visibleNodes = createMemo(() =>
    nodes.flatMap((node) => {
      const visible = visibleNode(node, ctx)
      return visible ? [visible] : []
    }),
  )

  return (
    <For each={visibleNodes()}>
      {(node, index) => (
        <>
          <Show when={index() > 0 && size > 0}>
            <text selectable={false}>{delimiter}</text>
          </Show>
          {renderNode(node, ctx)}
        </>
      )}
    </For>
  )
}

function visibleNode(node: StatuslineNode, ctx: StatuslineContext): StatuslineNode | undefined {
  if (Array.isArray(node)) {
    return node.find((plugin) => isPluginVisible(plugin, ctx))
  }
  if ("render" in node) {
    return isPluginVisible(node, ctx) ? node : undefined
  }
  return node.children.some((child) => visibleNode(child, ctx)) ? node : undefined
}

function StatuslineGroupView(props: { node: StatuslineGroup; ctx: StatuslineContext; root?: boolean }) {
  return (
    <box
      flexDirection="row"
      justifyContent={props.node.justifyContent}
      minHeight={props.root ? 1 : undefined}
      maxHeight={props.root ? 1 : undefined}
      marginBottom={props.root ? 1 : undefined}
      paddingLeft={props.root ? 3 : undefined}
      paddingRight={props.root ? 3 : undefined}
    >
      {nodesWithGap(props.node.children, props.node.gap ?? 0, props.ctx)}
    </box>
  )
}

function StatuslinePluginView(props: { plugin: StatuslinePlugin; ctx: StatuslineContext }) {
  return (
    <Show when={isPluginVisible(props.plugin, props.ctx)}>
      <StatuslinePluginMount
        plugin={props.plugin}
        ctx={props.ctx}
      />
    </Show>
  )
}

function StatuslineSlotView(props: { plugins: StatuslineSlot; ctx: StatuslineContext }) {
  const plugin = createMemo(() => props.plugins.find((plugin) => isPluginVisible(plugin, props.ctx)))

  return (
    <Show
      when={plugin()}
      keyed
    >
      {(current: StatuslinePlugin) => (
        <StatuslinePluginMount
          plugin={current}
          ctx={props.ctx}
        />
      )}
    </Show>
  )
}

function StatuslinePluginMount(props: { plugin: StatuslinePlugin; ctx: StatuslineContext }) {
  return <box flexDirection="row">{props.plugin.render(props.ctx)}</box>
}

function isPluginVisible(plugin: StatuslinePlugin, ctx: StatuslineContext) {
  return plugin.visible?.(ctx) !== false
}

export function Statusline() {
  const app = useAppContext()
  const { theme } = useTheme()
  const now = createClock()
  const color = (value: HighlightGroup) => theme().get(value)
  const Text: StatuslineContext["Text"] = (props) => (
    <text
      fg={color(props.color ?? "text")}
      selectable={false}
    >
      {props.children}
    </text>
  )
  const ctx: StatuslineContext = {
    app,
    now,
    color,
    Text,
  }

  return (
    <StatuslineGroupView
      node={defaultStatuslineLayout}
      ctx={ctx}
      root
    />
  )
}

export type { StatuslineContext, StatuslineGroup, StatuslinePlugin } from "./statusline-types"

function createClock() {
  const [now, setNow] = createSignal(Date.now())
  const id = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS)
  onCleanup(() => clearInterval(id))
  return now
}
