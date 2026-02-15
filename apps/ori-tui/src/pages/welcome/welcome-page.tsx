import { useTheme } from "@app/providers/theme"
import { TextAttributes } from "@opentui/core"
import { createMemo, For } from "solid-js"

type CommandRowProps = {
  shortcut: string
  label: string
}

export function WelcomePage() {
  const { theme } = useTheme()
  const palette = theme

  const commands: CommandRowProps[] = [{ shortcut: "ctrl+x c", label: "choose db" }]

  const label = createMemo(() => {
    return ""
  })

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      padding={2}
      alignItems="center"
      justifyContent="center"
    >
      <text
        attributes={TextAttributes.BOLD}
        fg={palette().get("text")}
        paddingBottom={1}
      >
        welcome to ori
      </text>
      <text fg={palette().get("text_muted")}>{label()}</text>
      <box height={2} />
      <box
        flexDirection="column"
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        width={48}
      >
        <For each={commands}>{(command) => <CommandRow {...command} />}</For>
      </box>
      <box height={2} />
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
      <text
        fg={palette().get("primary")}
        attributes={TextAttributes.BOLD}
      >
        {props.shortcut}
      </text>
    </box>
  )
}
