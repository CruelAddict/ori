import { TextAttributes } from "@opentui/core"
import { useTheme } from "@ui/providers/theme"
import { type Accessor, Show } from "solid-js"

type CommandRowProps = {
  shortcut: string
  label: string
}

type WelcomePaneProps = {
  canBrowseSelected: Accessor<boolean>
}

export function WelcomePane(props: WelcomePaneProps) {
  const { theme } = useTheme()
  const palette = theme

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      padding={2}
      alignItems="center"
      justifyContent="center"
    >
      <box
        flexDirection="row"
        justifyContent="center"
        alignItems="flex-end"
        width={"100%"}
      >
        <ascii_font
          text="ORI"
          font="tiny"
          color={palette().get("text")}
        />
        <text
          attributes={TextAttributes.DIM}
          marginLeft={2}
          fg={palette().get("text")}
        >
          v0.0.1
        </text>
      </box>
      <box height={2} />
      <box
        flexDirection="column"
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        width={"60%"}
      >
        <CommandRow
          shortcut="q"
          label="open query console"
        />
        <CommandRow
          shortcut="s"
          label="search introspection results"
        />
        <Show
          when={props.canBrowseSelected()}
          fallback={<box height={2} />}
        >
          <CommandRow
            shortcut="ctrl+x enter"
            label="view table content"
          />
        </Show>
      </box>
      <box height={8} />
    </box>
  )
}

function CommandRow(props: CommandRowProps) {
  const { theme } = useTheme()
  const palette = theme
  return (
    <box
      flexDirection="row"
      justifyContent="space-between"
      width="100%"
      paddingBottom={1}
    >
      <text fg={palette().get("text")}>{props.label}</text>
      <text fg={palette().get("accent")}>{props.shortcut}</text>
    </box>
  )
}
