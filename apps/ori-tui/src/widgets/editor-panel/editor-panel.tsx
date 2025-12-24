import { useTheme } from "@app/providers/theme";
import { type KeyBinding, KeyScope } from "@src/core/services/key-scopes";
import type { EditorPaneViewModel } from "@src/features/editor-pane/use-editor-pane";
import { Show } from "solid-js";
import { Buffer } from "./buffer";

export type EditorPanelProps = {
    viewModel: EditorPaneViewModel;
};

export function EditorPanel(props: EditorPanelProps) {
    const pane = props.viewModel;
    const { theme } = useTheme();
    const paletteValue = theme();

    const handleTextChange = (text: string, info: { modified: boolean }) => {
        if (info.modified) {
            pane.onQueryChange(text);
            return;
        }
    };

    const handleUnfocus = () => {
        pane.unfocus();
    };

    const keyBindings: KeyBinding[] = [
        {
            pattern: "enter",
            mode: "leader",
            handler: () => {
                void pane.executeQuery();
            },
            preventDefault: true,
        },
    ];

    return (
        <KeyScope
            id="connection-view.editor"
            bindings={keyBindings}
            enabled={pane.isFocused}
        >
            <box
                flexDirection="column"
                minHeight={3}
            >
                <Buffer
                    initialText={pane.queryText()}
                    isFocused={pane.isFocused}
                    onTextChange={handleTextChange}
                    onUnfocus={handleUnfocus}
                />
                <Show when={pane.isExecuting()}>
                    <box paddingTop={1}>
                        <text fg={paletteValue.warning}>Executing query...</text>
                    </box>
                </Show>
            </box>
        </KeyScope>
    );
}
