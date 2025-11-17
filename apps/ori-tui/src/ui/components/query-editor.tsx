import { Show, createEffect } from "solid-js";
import type { TextareaRenderable } from "@opentui/core";

export interface QueryEditorProps {
    configurationName: string;
    value: string;
    onChange: (text: string) => void;
    onExecute: () => void;
    executing: boolean;
    focused: boolean;
}

export function QueryEditor(props: QueryEditorProps) {
    let textarea: TextareaRenderable | undefined;

    createEffect(() => {
        if (props.focused && textarea) {
            textarea.focus();
        }
    });

    createEffect(() => {
        // Sync textarea content with props.value
        if (textarea && props.value !== textarea.plainText) {
            textarea.setText(props.value, { history: false });
        }
    });

    const handleChange = () => {
        if (textarea) {
            props.onChange(textarea.plainText);
        }
    };

    const handleSubmit = () => {
        if (!props.executing && textarea && textarea.plainText.trim()) {
            props.onExecute();
        }
    };

    return (
        <box flexDirection="column" flexGrow={1} padding={1}>
            <textarea
                ref={(r: TextareaRenderable | undefined) => (textarea = r)}
                placeholder="Type to begin... (Enter inserts newline, Ctrl+X then Enter executes)"
                textColor="white"
                focusedTextColor="white"
                backgroundColor="#1e1e1e"
                focusedBackgroundColor="#252525"
                minHeight={3}
                maxHeight={12}
                onContentChange={handleChange}
                onSubmit={handleSubmit}
                keyBindings={[
                    { name: "return", action: "newline" },
                ]}
            />
            <Show when={props.executing}>
                <box paddingTop={1}>
                    <text fg="yellow">Executing query...</text>
                </box>
            </Show>
        </box>
    );
}
