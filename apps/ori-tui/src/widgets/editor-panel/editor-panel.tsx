import { useTheme } from "@app/providers/theme";
import type { EditorPaneViewModel } from "@src/features/editor-pane/use-editor-pane";
import { Show, createEffect, createSignal } from "solid-js";
import { Buffer, type BufferApi, type BufferPalette } from "./buffer";

export type EditorPanelProps = {
    viewModel: EditorPaneViewModel;
};

export function EditorPanel(props: EditorPanelProps) {
    const pane = props.viewModel;
    const { theme } = useTheme();
    const paletteValue = theme();
    const palette: BufferPalette = {
        editorText: paletteValue.editorText,
        primary: paletteValue.primary,
    };

    const [bufferApi, setBufferApi] = createSignal<BufferApi>();
    const [lastPushed, setLastPushed] = createSignal<{ text: string; version: string }>();

    const handlePush = (text: string, version: string) => {
        setLastPushed({ text, version });
        pane.onQueryChange(text);
    };

    const handleUnfocus = () => {
        pane.unfocus();
    };

    createEffect(() => {
        const api = bufferApi();
        if (!api) {
            return;
        }
        const text = pane.queryText();
        const pushed = lastPushed();
        const version = pushed && pushed.text === text ? pushed.version : undefined;
        api.acceptExternal(text, version);
    });

    return (
        <box
            flexDirection="column"
            minHeight={3}
        >
            <Buffer
                initialText={pane.queryText()}
                isFocused={pane.isFocused}
                palette={palette}
                onPush={handlePush}
                onUnfocus={handleUnfocus}
                registerApi={setBufferApi}
            />
            <Show when={pane.isExecuting()}>
                <box paddingTop={1}>
                    <text fg={paletteValue.warning}>Executing query...</text>
                </box>
            </Show>
        </box>
    );
}
