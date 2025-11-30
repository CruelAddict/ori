import { useTheme } from "@app/providers/theme";
import { RGBA, TextAttributes } from "@opentui/core";
import { For } from "solid-js";

type CommandRowProps = {
    shortcut: string;
    label: string;
};

export function WelcomePane() {
    const { theme } = useTheme();
    const palette = theme;

    const commands: CommandRowProps[] = [{ shortcut: "q", label: "open query console" }];

    return (
        <box
            flexDirection="column"
            flexGrow={1}
            padding={2}
            backgroundColor={palette().background}
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
                    fg={RGBA.fromHex(palette().text)}
                />
                <text
                    attributes={TextAttributes.DIM}
                    marginLeft={2}
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
                width={48}
            >
                <For each={commands}>{(command) => <CommandRow {...command} />}</For>
            </box>
            <box height={8} />
        </box>
    );
}

function CommandRow(props: CommandRowProps) {
    const { theme } = useTheme();
    const palette = theme;
    return (
        <box
            flexDirection="row"
            justifyContent="space-between"
            width="100%"
            paddingBottom={1}
        >
            <text fg={palette().text}>{props.label}</text>
            <text fg={palette().accent}>{props.shortcut}</text>
        </box>
    );
}
