import type { MouseEvent } from "@opentui/core"
import type { AppSelectionAction } from "@ui/selection/selection-lock"
import { createSignal, For, Show } from "solid-js"
import type { StatuslineContext, StatuslinePlugin } from "../statusline-types"

export const selectionActionsPlugin: StatuslinePlugin = {
  visible: (ctx) => ctx.app.selection() !== undefined,
  render: (ctx) => <SelectionActionsView ctx={ctx} />,
}

function SelectionActionsView(props: { ctx: StatuslineContext }) {
  const actions = () => {
    const current = props.ctx.app.selection()?.actions ?? []
    return ["ctrl+y", "ctrl+k", "backspace", "y"].flatMap((key) => current.filter((action) => action.key === key))
  }

  return (
    <Show when={actions().length > 0}>
      <For each={actions()}>
        {(action) => (
          <SelectionAction
            action={action}
            ctx={props.ctx}
          />
        )}
      </For>
    </Show>
  )
}

function SelectionAction(props: { action: AppSelectionAction; ctx: StatuslineContext }) {
  const [hovered, setHovered] = createSignal(false)
  const handleMouseDown = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    props.action.run()
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
