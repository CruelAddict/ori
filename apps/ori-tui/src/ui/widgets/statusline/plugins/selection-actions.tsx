import type { MouseEvent } from "@opentui/core"
import type { SelectionAction } from "@ui/providers/selection"
import { createSignal, For, Show } from "solid-js"
import type { StatuslineContext, StatuslinePlugin } from "../statusline-types"

export const selectionActionsPlugin: StatuslinePlugin = {
  visible: (ctx) => ctx.app.selectionActions().length > 0,
  render: (ctx) => <SelectionActionsView ctx={ctx} />,
}

function SelectionActionsView(props: { ctx: StatuslineContext }) {
  const actions = () => {
    const current = props.ctx.app.selectionActions()
    return ["ctrl+y", "ctrl+k", "backspace", "y"].flatMap((key) => current.filter((action) => action.key === key))
  }

  return (
    <Show when={actions().length > 0}>
      <For each={actions()}>
        {(action) => (
          <SelectionActionView
            action={action}
            ctx={props.ctx}
          />
        )}
      </For>
    </Show>
  )
}

function SelectionActionView(props: { action: SelectionAction; ctx: StatuslineContext }) {
  const [hovered, setHovered] = createSignal(false)
  const handleMouseDown = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    props.action.run({ clearSelection: true })
  }

  return (
    /* biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI uses box as the pointer target. */
    /* biome-ignore lint/a11y/useKeyWithMouseEvents: SelectionHotkeys registers equivalent keyboard shortcuts. */
    <box
      flexDirection="row"
      id={`selection-action-${props.action.key}`}
      marginRight={2}
      onMouseDown={handleMouseDown}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
    >
      <props.ctx.Text color={hovered() ? "primary" : "text"}>{props.action.key}</props.ctx.Text>
      <props.ctx.Text> </props.ctx.Text>
      <props.ctx.Text color={hovered() ? "primary" : "text_muted"}>{props.action.label}</props.ctx.Text>
    </box>
  )
}
