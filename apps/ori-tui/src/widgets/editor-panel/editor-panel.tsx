import { useTheme } from "@app/providers/theme";
import type { TextareaRenderable } from "@opentui/core";
import { type KeyBinding, KeyScope } from "@src/core/services/key-scopes";
import type { EditorPaneViewModel } from "@src/features/editor-pane/use-editor-pane";
import { createEffect, Show } from "solid-js";

const EDITOR_SCOPE_ID = "connection-view.editor";

export type EditorPanelProps = {
    viewModel: EditorPaneViewModel;
};

export function EditorPanel(props: EditorPanelProps) {
    const pane = props.viewModel;
    let textarea: TextareaRenderable | undefined;
    const { theme } = useTheme();
    const palette = theme;

    const bindings: KeyBinding[] = [
        {
            pattern: "escape",
            handler: () => {
                pane.unfocus();
            },
            preventDefault: true,
        },
    ];

    createEffect(() => {
        if (pane.isFocused() && textarea) {
            textarea.focus();
        } else {
            textarea?.blur();
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
        <KeyScope
            id={EDITOR_SCOPE_ID}
            bindings={bindings}
            enabled={pane.isFocused}
        >
            <box flexDirection="column">
                <box
                    flexDirection="column"
                    flexGrow={1}
                    padding={1}
                >
                    <textarea
                        ref={(renderable: TextareaRenderable | undefined) => {
                            textarea = renderable;
                        }}
                        placeholder={`Type to begin... (Enter inserts newline, Ctrl+X then Enter executes)`}
                        textColor={palette().editorText}
                        focusedTextColor={palette().editorText}
                        backgroundColor={palette().background}
                        focusedBackgroundColor={palette().background}
                        cursorColor={palette().primary}
                        minHeight={3}
                        maxHeight={12}
                        onContentChange={handleChange}
                        onSubmit={handleSubmit}
                        keyBindings={[{ name: "return", action: "newline" }]}
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
