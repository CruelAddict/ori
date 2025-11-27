import { Show, createEffect } from "solid-js";
import { KeyScope, type KeyBinding } from "@src/core/services/key-scopes";
import type { EditorPaneViewModel } from "@src/features/editor-pane/use-editor-pane";
import type { TextareaRenderable } from "@opentui/core";
import { useTheme } from "@app/providers/theme";

const EDITOR_SCOPE_ID = "connection-view.editor";

export interface EditorPanelProps {
    viewModel: EditorPaneViewModel;
    borderColor?: (focused: boolean) => string;
}

export function EditorPanel(props: EditorPanelProps) {
    const pane = props.viewModel;
    let textarea: TextareaRenderable | undefined;
    const { theme } = useTheme();
    const palette = theme;

    const bindings: KeyBinding[] = [];

    createEffect(() => {
        if (pane.isFocused() && textarea) {
            textarea.focus();
        }
    });

    createEffect(() => {
        const text = pane.queryText();
        if (textarea && text !== textarea.plainText) {
            textarea.setText(text, { history: false });
        }
    });

    const handleChange = () => {
        if (textarea) {
            pane.onQueryChange(textarea.plainText);
        }
    };

    const handleSubmit = () => {
        if (!pane.isExecuting() && textarea && textarea.plainText.trim()) {
            void pane.executeQuery();
        }
    };

    return (
        <KeyScope id={EDITOR_SCOPE_ID} bindings={bindings} enabled={pane.isFocused}>
            <box
                flexDirection="column"
            >
                <box flexDirection="column" flexGrow={1} padding={1}>
                    <textarea
                        ref={(renderable: TextareaRenderable | undefined) => (textarea = renderable)}
                        placeholder={`Type to begin... (Enter inserts newline, Ctrl+X then Enter executes)`}
                        textColor={palette().editorText}
                        focusedTextColor={palette().editorText}
                        backgroundColor={palette().editorBackground}
                        focusedBackgroundColor={palette().editorBackgroundFocused}
                        minHeight={3}
                        maxHeight={12}
                        onContentChange={handleChange}
                        onSubmit={handleSubmit}
                        keyBindings={[
                            { name: "return", action: "newline" },
                        ]}
                    />
                    <Show when={pane.isExecuting()}>
                        <box paddingTop={1}>
                            <text fg={palette().warning}>Executing query...</text>
                        </box>
                    </Show>
                </box>
            </box>
        </KeyScope>
    );
}
