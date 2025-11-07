import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/solid";
import type { Configuration } from "@src/lib/configuration";
import { For, createMemo } from "solid-js";

export interface ConnectionViewProps {
    configuration: Configuration;
    onBack: () => void;
}

export function ConnectionView(props: ConnectionViewProps) {
    const rows = createMemo(() => [
        { label: "Type", value: props.configuration.type },
        { label: "Host", value: props.configuration.host },
        { label: "Port", value: String(props.configuration.port) },
        { label: "Database", value: props.configuration.database },
        { label: "Username", value: props.configuration.username },
    ]);

    const triggerBack = () => {
        props.onBack?.();
    };

    useKeyboard((evt) => {
        if (
            evt.name === "escape" ||
            evt.name === "backspace" ||
            (evt.ctrl && evt.name === "[")
        ) {
            evt.preventDefault?.();
            triggerBack();
        }
    });

    return (
        <box flexDirection="column" flexGrow={1} padding={1}>
            <text attributes={TextAttributes.BOLD}>Connection</text>
            <text attributes={TextAttributes.DIM}>{props.configuration.name}</text>
            <box height={1} />

            <box flexDirection="column" paddingLeft={1}>
                <For each={rows()}>
                    {(row) => (
                        <box>
                            <text attributes={TextAttributes.BOLD}>{row.label}: </text>
                            <text>{row.value}</text>
                        </box>
                    )}
                </For>
            </box>

            <box height={1} />
            <text attributes={TextAttributes.DIM}>
                Press Esc to go back • Actions coming soon
            </text>
        </box>
    );
}
